// 全局变量
let tableData = { // 表格数据
    columns: ['组名', '成员'], // 默认列
    rows: [] // 行数据
};
let ungroupedMembers = []; // 未分组成员列表
let client = null; // WebTorrent客户端实例
let torrent = null; // 当前种子实例
let connectedPeers = {}; // 存储已连接的对等点
let myPeerId = null; // 我的唯一ID
let roomId = 'default-room'; // 默认房间ID

// 硬编码的种子信息 - 所有用户都使用这些固定值
const FIXED_SEED_ID = 'group-management-app-seed-v1'; 
// 固定的InfoHash - 所有客户端使用相同的种子哈希
const FIXED_INFO_HASH = '000000000000000000000000000000002d2ff9e8';
// 固定种子数据
const FIXED_SEED_DATA = JSON.stringify({
    roomId: 'default-room',
    creator: 'system',
    fixedId: FIXED_SEED_ID,
    createdAt: '2023-10-10T00:00:00.000Z' // 固定的创建时间
});

// 跟踪器列表
const ANNOUNCE_TRACKERS = [
    'wss://tracker.btorrent.xyz',
    'wss://tracker.openwebtorrent.com'
];

let reconnectAttempts = 0; // 连接尝试次数
let isInitializing = false; // 是否正在初始化WebTorrent
let webtorrentInitialized = false; // WebTorrent是否已初始化
let isBufferAvailable = false; // Buffer是否可用
let connectionTimeoutId = null; // 连接超时定时器ID

// DOM元素
const addGroupBtn = document.getElementById('add-group');
const saveLocalBtn = document.getElementById('save-local');
const loadLocalBtn = document.getElementById('load-local');
const exportDataBtn = document.getElementById('export-data');
const tableBody = document.getElementById('table-body');
const ungroupedList = document.getElementById('ungrouped-list');
const newMemberInput = document.getElementById('new-member-name');
const addUngroupedBtn = document.getElementById('add-ungrouped');

// WebTorrent连接相关元素
const connectionStatus = document.getElementById('connection-status');
const roomIdInput = document.getElementById('room-id');
const peerList = document.getElementById('peer-list');

// 初始化应用函数
function initApp() {
    console.log('初始化应用');
    
    // 如果已经在执行初始化，则退出
    if (isInitializing) return;
    isInitializing = true;
    
    try {
        // 设置一个标记，表示是否是新用户（首次加载）
        window.isNewUser = !localStorage.getItem('groupTableData');
        console.log('是否为新用户:', window.isNewUser);
        
        // 从localStorage加载数据
        loadData();
        
        // 渲染表格和未分组成员
        renderTable();
        renderUngroupedMembers();
        
        // 生成唯一的对等点ID
        myPeerId = generatePeerId();
        
        // 直接检查WebTorrent是否可用 - 使用全局变量和setTimeout确保加载
        setTimeout(() => {
            if (typeof WebTorrent === 'function') {
                console.log('WebTorrent函数已存在，直接初始化');
                initWebTorrent();
            } else {
                console.error('WebTorrent未定义，检查全局对象');
                connectionStatus.textContent = '网络组件未加载，刷新页面重试';
                connectionStatus.style.backgroundColor = '#f8d7da';
                isInitializing = false;
                
                // 即使WebTorrent失败，也允许用户使用本地功能
                renderTable();
                renderUngroupedMembers();
            }
        }, 1000); // 给WebTorrent额外的时间加载
    } catch (err) {
        console.error('应用初始化失败:', err);
        connectionStatus.textContent = '应用初始化失败: ' + err.message;
        isInitializing = false;
    }
}

// 初始化函数 - 主要设置事件监听
function init() {
    console.log('设置事件监听');
    
    // 添加事件监听
    addGroupBtn.addEventListener('click', addNewGroup);
    document.getElementById('save-local').addEventListener('click', saveData);
    document.getElementById('load-local').addEventListener('click', loadStoredData);
    exportDataBtn.addEventListener('click', exportGroupData);
    addUngroupedBtn.addEventListener('click', addUngroupedMember);
    
    // 未分组成员输入框回车事件
    newMemberInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            addUngroupedMember();
        }
    });
    
    // 延迟初始化应用，确保DOM完全加载
    setTimeout(initApp, 1000);
}

// 生成唯一的对等点ID
function generatePeerId() {
    return 'peer-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// 检查和设置Buffer
function ensureBuffer() {
    try {
        // 检查全局Buffer
        if (typeof Buffer !== 'undefined') {
            console.log('全局Buffer可用');
            return true;
        }
        
        // 检查buffer库
        if (window.buffer && window.buffer.Buffer) {
            console.log('使用buffer库');
            window.Buffer = window.buffer.Buffer;
            return true;
        }
        
        // 尝试使用安全的Buffer替代方案
        console.log('创建Buffer替代方案');
        window.Buffer = {
            from: function(data, encoding) {
                if (typeof data === 'string') {
                    const encoder = new TextEncoder();
                    return encoder.encode(data);
                }
                return new Uint8Array(data);
            },
            isBuffer: function(obj) {
                return obj instanceof Uint8Array;
            },
            alloc: function(size) {
                return new Uint8Array(size);
            }
        };
        return true;
    } catch (err) {
        console.error('无法设置Buffer:', err);
        return false;
    }
}

// 初始化WebTorrent
function initWebTorrent() {
    try {
        console.log('正在初始化WebTorrent');
        connectionStatus.textContent = '正在初始化网络连接...';
        
        // 确保Buffer在全局可用
        isBufferAvailable = ensureBuffer();
        if (!isBufferAvailable) {
            connectionStatus.textContent = 'Buffer库不可用，只能使用本地模式';
            connectionStatus.style.backgroundColor = '#f8d7da';
            renderTable();
            renderUngroupedMembers();
            isInitializing = false;
            return;
        }
        
        // 销毁任何现有的客户端实例
        if (client) {
            try {
                client.destroy();
                console.log('已销毁旧的WebTorrent客户端');
            } catch (e) {
                console.error('销毁旧客户端失败:', e);
            }
        }
        
        // 确保WebTorrent构造函数存在并且可用
        if (typeof WebTorrent !== 'function') {
            console.error('WebTorrent不是一个构造函数，可能加载失败');
            connectionStatus.textContent = 'WebTorrent库无法正确初始化';
            connectionStatus.style.backgroundColor = '#f8d7da';
            isInitializing = false;
            return;
        }
        
        // 尝试实例化WebTorrent客户端
        try {
            // 创建WebTorrent客户端
            console.log('创建WebTorrent客户端');
            client = new WebTorrent({
                tracker: {
                    announce: ANNOUNCE_TRACKERS
                },
                maxConns: 50,  // 增加最大连接数
                dht: false     // 禁用DHT以简化连接
            });
            
            if (!client) {
                throw new Error('WebTorrent客户端创建失败');
            }
            
            console.log('WebTorrent客户端创建成功');
            connectionStatus.textContent = '正在连接到房间...';
            
            // 设置WebTorrent事件监听
            client.on('error', (err) => {
                console.error('WebTorrent错误:', err);
                
                // 忽略特定错误
                if (err.message && (
                    err.message.includes('duplicate torrent') || 
                    err.message.includes('Cannot add duplicate')
                )) {
                    console.log('忽略重复种子错误');
                    return;
                }
                
                connectionStatus.textContent = '连接错误: ' + err.message;
                connectionStatus.classList.remove('connected');
                
                // 尝试重新连接
                if (reconnectAttempts < 3) {
                    reconnectAttempts++;
                    console.log(`连接出错，第${reconnectAttempts}次重试...`);
                    setTimeout(() => {
                        joinRoom();
                    }, 2000);
                }
            });
            
            // 添加种子事件
            client.on('torrent', (t) => {
                console.log('发现种子:', t.infoHash);
                if (t !== torrent) {
                    setupTorrentEvents(t);
                }
            });
            
            // 成功创建客户端后自动加入房间
            webtorrentInitialized = true;
            isInitializing = false;
            
            console.log('WebTorrent初始化完成，准备加入房间');
            setTimeout(() => {
                joinRoom();
            }, 1000);
        } catch (e) {
            console.error('创建WebTorrent客户端失败:', e);
            connectionStatus.textContent = 'WebTorrent客户端创建失败: ' + e.message;
            connectionStatus.style.backgroundColor = '#f8d7da';
            isInitializing = false;
        }
    } catch (err) {
        console.error('初始化WebTorrent失败:', err);
        connectionStatus.textContent = 'WebTorrent初始化失败: ' + err.message;
        connectionStatus.style.backgroundColor = '#f8d7da';
        isInitializing = false;
        
        // 标记为本地模式
        webtorrentInitialized = false;
        
        // 即使WebTorrent失败，也允许用户使用本地功能
        renderTable();
        renderUngroupedMembers();
    }
}

// 加入房间
function joinRoom() {
    if (!client) {
        connectionStatus.textContent = 'WebTorrent客户端未初始化，请刷新页面重试';
        return;
    }
    
    // 使用默认房间ID
    roomId = 'default-room';
    
    connectionStatus.textContent = '正在连接到房间...';
    
    try {
        // 清理现有的种子
        cleanupExistingTorrents();
        
        // 重置对等点
        connectedPeers = {};
        updatePeerList();
        
        // 设置连接超时
        if (connectionTimeoutId) {
            clearTimeout(connectionTimeoutId);
        }
        
        connectionTimeoutId = setTimeout(() => {
            console.log('连接超时，创建固定种子');
            createFixedSeed();
        }, 15000); // 增加到15秒等待时间
        
        // 尝试先加入已有的种子
        console.log('尝试加入固定种子:', FIXED_INFO_HASH);
        
        // 构建磁力链接 - 使用固定的InfoHash
        let magnetUri = `magnet:?xt=urn:btih:${FIXED_INFO_HASH}&dn=${encodeURIComponent(FIXED_SEED_ID)}`;
        
        // 添加tracker
        for (const tracker of ANNOUNCE_TRACKERS) {
            magnetUri += `&tr=${encodeURIComponent(tracker)}`;
        }
        
        console.log('加入房间使用磁力链接:', magnetUri);
        
        // 显示连接状态
        connectionStatus.textContent = '正在连接到跟踪服务器...';
        
        // 添加更多调试信息
        client.on('warning', function(warning) {
            console.log('WebTorrent警告:', warning);
        });
        
        // 监听跟踪器事件
        client.on('trackerEvent', function(eventName, data) {
            console.log('跟踪器事件:', eventName, data);
        });
        
        // 尝试加入已有的种子
        client.add(magnetUri, { announce: ANNOUNCE_TRACKERS }, function(t) {
            // 清除超时
            if (connectionTimeoutId) {
                clearTimeout(connectionTimeoutId);
                connectionTimeoutId = null;
            }
            
            console.log('成功加入现有种子:', t.infoHash);
            torrent = t;
            setupTorrentEvents(torrent);
            updateRoomStatus();
            
            // 立即广播存在
            setTimeout(() => {
                broadcastData({
                    type: 'ping',
                    message: '新用户加入'
                });
            }, 1000);
        }).on('error', function(err) {
            console.error('加入现有种子失败:', err);
            
            // 清除超时，手动创建新的种子
            if (connectionTimeoutId) {
                clearTimeout(connectionTimeoutId);
                connectionTimeoutId = null;
            }
            
            // 创建新的固定种子
            setTimeout(() => {
                createFixedSeed();
            }, 1000);
        });
    } catch (err) {
        console.error('加入房间失败:', err);
        connectionStatus.textContent = '加入房间失败: ' + err.message;
        
        // 清除超时
        if (connectionTimeoutId) {
            clearTimeout(connectionTimeoutId);
            connectionTimeoutId = null;
        }
        
        // 创建新的房间
        setTimeout(() => {
            createFixedSeed();
        }, 1000);
    }
}

// 创建固定种子
function createFixedSeed() {
    console.log('创建固定种子...');
    
    // 清除连接超时
    if (connectionTimeoutId) {
        clearTimeout(connectionTimeoutId);
        connectionTimeoutId = null;
    }
    
    try {
        // 使用固定数据创建种子
        const seedData = new Blob([FIXED_SEED_DATA]);
        
        // 固定的种子选项
        const seedOpts = {
            name: FIXED_SEED_ID,
            comment: '分组管理应用房间',
            announce: ANNOUNCE_TRACKERS,
            // 注意：WebTorrent可能无法完全支持硬编码的infoHash
            private: false
        };
        
        // 更新状态显示
        connectionStatus.textContent = '正在创建房间...';
        
        // 添加种子
        client.seed(seedData, seedOpts, (seed) => {
            torrent = seed;
            console.log('成功创建固定种子:', torrent.infoHash);
            
            // 设置房间事件
            setupTorrentEvents(torrent);
            
            // 更新状态
            updateRoomStatus();
            
            // 定期检查连接状态
            setInterval(() => {
                checkConnectionStatus();
            }, 30000);
        });
    } catch (err) {
        console.error('创建固定种子失败:', err);
        connectionStatus.textContent = '创建房间失败：' + err.message;
        
        // 即使连接失败也允许用户使用本地模式
        connectionStatus.textContent = '使用本地模式 (连接失败)';
        connectionStatus.style.backgroundColor = '#f8d7da';
    }
}

// 检查连接状态并尝试恢复
function checkConnectionStatus() {
    // 如果没有连接的对等点，尝试重新广播
    if (torrent && (!torrent.wires || torrent.wires.length === 0)) {
        console.log('未检测到连接的对等点，尝试重新广播');
        
        // 发送一个ping消息到跟踪器
        try {
            if (torrent.announce) {
                torrent.announce();
                console.log('已向跟踪器宣告');
            }
            
            // 如果有数据，广播存在
            if (tableData && tableData.rows && tableData.rows.length > 0) {
                broadcastData({
                    type: 'ping',
                    message: '重新广播'
                });
            }
        } catch (e) {
            console.error('重新广播失败:', e);
        }
    }
}

// 更新房间状态
function updateRoomStatus() {
    connectionStatus.textContent = '已连接到房间';
    connectionStatus.classList.add('connected');
    reconnectAttempts = 0;
    
    // 广播自己的存在
    broadcastPresence();
}

// 清理现有的种子
function cleanupExistingTorrents() {
    if (client && client.torrents.length > 0) {
        console.log(`清理 ${client.torrents.length} 个现有种子`);
        
        const torrentsToRemove = [...client.torrents]; // 创建副本以避免修改迭代中的数组
        torrentsToRemove.forEach(t => {
            try {
                client.remove(t.infoHash);
                console.log(`成功移除种子: ${t.infoHash}`);
            } catch (err) {
                console.warn(`移除种子失败: ${t.infoHash}`, err);
            }
        });
        
        // 重置对等点
        connectedPeers = {};
        updatePeerList();
    }
}

// 广播自己的存在
function broadcastPresence() {
    // 每隔一段时间广播一次自己的存在，帮助其他用户发现
    setInterval(() => {
        if (torrent && torrent.wires && torrent.wires.length > 0) {
            console.log('广播自己的存在，当前连接数:', torrent.wires.length);
            // 这只是为了触发一些网络活动，帮助对等点发现
            torrent.wires.forEach(wire => {
                try {
                    if (wire.sendMessage) {
                        wire.sendMessage({
                            type: 'ping',
                            from: myPeerId,
                            timestamp: Date.now()
                        });
                    }
                } catch (e) {
                    console.warn('发送ping失败:', e);
                }
            });
        } else {
            console.log('未检测到其他用户');
        }
    }, 5000); // 每5秒尝试一次
}

// 设置种子事件监听
function setupTorrentEvents(t) {
    // 对等点连接事件
    t.on('wire', (wire) => {
        // 确保wire有唯一ID
        if (!wire.peerId) {
            wire.peerId = 'peer-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        }
        
        console.log('新的对等点连接:', wire.peerId);
        
        try {
            // 为断开连接事件添加通知
            wire.once('close', () => {
                console.log('对等点关闭连接:', wire.peerId);
                if (wire.peerId && connectedPeers[wire.peerId]) {
                    delete connectedPeers[wire.peerId];
                    updatePeerList();
                }
            });
            
            // 设置数据通道 - 使用messageChannel扩展
            const messageExtension = setupMessageChannel(wire);
            
            // 添加name属性以满足Wire.use的要求
            if (!messageExtension.name && messageExtension.prototype && messageExtension.prototype.name) {
                messageExtension.name = messageExtension.prototype.name;
            }
            
            // 使用扩展
            wire.use(messageExtension);
            
            // 设置peerExtendedMapping以支持扩展
            if (!wire.peerExtendedMapping) {
                wire.peerExtendedMapping = {};
            }
            wire.peerExtendedMapping.messageChannel = 1; // 默认使用1作为扩展ID
            
            // 更新对等点列表
            if (wire.peerId && !connectedPeers[wire.peerId]) {
                connectedPeers[wire.peerId] = wire;
                updatePeerList();
                
                // 如果是新用户，等待更长时间再请求同步
                // 这样老用户有足够时间完成连接并能够回应
                const syncDelay = window.isNewUser ? 5000 : 2000;
                console.log(`新对等点连接，${syncDelay/1000}秒后请求同步数据`);
                
                // 发送当前数据给新连接的对等点
                setTimeout(() => {
                    // 如果是新用户，先发送同步请求而不是空数据
                    if (window.isNewUser || 
                        !tableData || 
                        !tableData.rows || 
                        tableData.rows.length === 0) {
                        console.log('作为新用户请求同步数据');
                        // 向所有客户端广播同步请求
                        broadcastData({
                            type: 'syncRequest',
                            message: '新客户端请求同步'
                        });
                    } else {
                        // 已有数据的用户直接发送给新连接的对等点
                        console.log('向新对等点发送同步数据');
                        sendSyncData(wire);
                    }
                }, syncDelay);
            }
        } catch (err) {
            console.error('设置wire扩展失败:', err);
        }
    });
    
    // 对等点断开连接事件
    t.on('wire-disconnect', (wire) => {
        console.log('对等点断开连接 (wire-disconnect):', wire.peerId);
        
        // 更新对等点列表
        if (wire.peerId && connectedPeers[wire.peerId]) {
            delete connectedPeers[wire.peerId];
            updatePeerList();
        }
    });
    
    // 完成下载事件
    t.on('done', () => {
        console.log('种子下载完成');
    });
    
    // 错误事件
    t.on('error', (err) => {
        console.error('种子错误:', err);
    });
    
    // 种子就绪事件
    t.on('ready', () => {
        console.log('种子就绪:', t.infoHash);
        
        // 种子就绪后，定期广播存在
        setInterval(() => {
            broadcastData({
                type: 'ping',
                message: '我在线'
            });
        }, 30000); // 每30秒发送一次ping，保持连接活跃
    });
}

// 设置消息通道
function setupMessageChannel(wire) {
    // 返回带有name属性的扩展对象
    const extension = function(wire) {
        try {
            // 实现自定义消息协议
            wire.extendedHandshake = wire.extendedHandshake || {};
            wire.extendedHandshake.messageChannel = true;
            
            // 创建一个安全的send方法
            wire.sendMessage = (data) => {
                try {
                    // 确保数据有类型和来源
                    if (!data.type) {
                        console.warn('尝试发送无类型数据:', data);
                        data.type = 'unknown';
                    }
                    
                    if (!data.from) {
                        data.from = myPeerId;
                    }
                    
                    // 添加时间戳
                    if (!data.timestamp) {
                        data.timestamp = Date.now();
                    }
                    
                    const jsonStr = JSON.stringify(data);
                    console.log('发送JSON数据:', jsonStr.substring(0, 50) + (jsonStr.length > 50 ? '...' : ''));
                    
                    // 使用TextEncoder替代Buffer，防止require错误
                    const encoder = new TextEncoder();
                    const buf = encoder.encode(jsonStr);
                    
                    // 确保使用正确的扩展ID而不是名称字符串
                    // 许多WebTorrent实现使用数字ID而不是名称字符串
                    if (wire.peerExtendedMapping && wire.peerExtendedMapping.messageChannel) {
                        wire.extended(wire.peerExtendedMapping.messageChannel, buf);
                    } else {
                        console.warn('对等点未支持messageChannel扩展，尝试使用名称');
                        try {
                            // 尝试使用扩展名称
                            wire.extended('messageChannel', buf);
                        } catch (err) {
                            console.error('使用扩展名称发送失败:', err);
                        }
                    }
                } catch (err) {
                    console.error('消息发送失败:', err);
                }
            };
            
            // 接收到扩展握手
            wire.on('extended', (ext, buf) => {
                try {
                    // 记录接收到的扩展消息类型
                    console.log('收到扩展消息类型:', ext, 
                        '是否为messageChannel:', ext === 'messageChannel' || 
                        (typeof ext === 'number' && ext === wire.peerExtendedMapping.messageChannel));
                    
                    // 处理消息通道扩展消息
                    if (ext === 'messageChannel' || 
                        (typeof ext === 'number' && ext === wire.peerExtendedMapping.messageChannel)) {
                        try {
                            if (!buf || buf.length === 0) {
                                console.warn('收到空的扩展消息');
                                return;
                            }
                            
                            // 打印buf的前几个字节，用于调试
                            let debugHex = '';
                            for (let i = 0; i < Math.min(20, buf.length); i++) {
                                debugHex += buf[i].toString(16).padStart(2, '0') + ' ';
                            }
                            console.log('收到的扩展消息前20字节(hex):', debugHex);
                            
                            // 安全解码二进制数据
                            const jsonStr = safeDecodeBuffer(buf);
                            if (!jsonStr) {
                                console.warn('无法解码扩展消息');
                                return;
                            }
                            
                            // 尝试解析并处理JSON数据
                            const data = safeParseJSON(jsonStr);
                            if (data) {
                                console.log('成功解析扩展消息，类型:', data.type);
                                handleDataReceived(data, wire);
                            }
                        } catch (err) {
                            console.error('解析消息失败:', err);
                        }
                    }
                } catch (err) {
                    console.error('处理扩展消息失败:', err);
                }
            });
        } catch (err) {
            console.error('设置消息通道失败:', err);
        }
    };
    
    // 为扩展添加必要的name属性
    extension.prototype.name = 'messageChannel';
    
    // 添加onExtendedHandshake方法，这在WebTorrent中很重要
    extension.prototype.onExtendedHandshake = function(handshake) {
        console.log('收到扩展握手:', handshake);
        // 可以在这里存储对等方的信息
        if (wire && handshake.messageChannel) {
            console.log('对等点支持messageChannel');
        }
    };
    
    // 添加onMessage方法，WebTorrent将通过此方法传递消息
    extension.prototype.onMessage = function(buf) {
        try {
            console.log('收到extension消息');
            
            // 添加更多的数据检查
            if (!buf || buf.length === 0) {
                console.warn('收到空的extension消息');
                return;
            }
            
            // 打印buf的前20个字节，用于调试
            let debugStr = '';
            for (let i = 0; i < Math.min(20, buf.length); i++) {
                debugStr += buf[i].toString(16).padStart(2, '0') + ' ';
            }
            console.log('收到的extension消息前20个字节: ', debugStr);
            
            // 安全解码二进制数据
            const jsonStr = safeDecodeBuffer(buf);
            if (!jsonStr) {
                console.warn('无法解码extension消息');
                return;
            }
            
            // 安全解析JSON数据
            const data = safeParseJSON(jsonStr);
            if (data) {
                console.log('成功解析extension消息，类型:', data.type);
                handleDataReceived(data, wire);
            }
        } catch (err) {
            console.error('处理extension消息失败:', err);
        }
    };
    
    return extension;
}

// 安全解码二进制数据为字符串
function safeDecodeBuffer(buf) {
    try {
        if (!buf || buf.length === 0) {
            console.warn('尝试解码空缓冲区');
            return null;
        }
        
        // 使用TextDecoder替代Buffer，防止require错误
        const decoder = new TextDecoder('utf-8', {fatal: false});
        const jsonStr = decoder.decode(buf);
        
        // 基本验证
        if (!jsonStr || jsonStr.length < 2) {
            console.warn('解码后的数据太短，不可能是有效的JSON');
            return null;
        }
        
        console.log('解码后的JSON字符串前50个字符:', jsonStr.substring(0, 50));
        return jsonStr;
    } catch (err) {
        console.error('解码二进制数据失败:', err);
        return null;
    }
}

// 安全地解析JSON字符串
function safeParseJSON(jsonStr) {
    try {
        if (!jsonStr || typeof jsonStr !== 'string') {
            console.warn('尝试解析非字符串数据');
            return null;
        }
        
        // 检查是否有BOM (Byte Order Mark)或其他非JSON前缀
        let cleanJsonStr = jsonStr;
        
        // 移除UTF-8 BOM
        if (cleanJsonStr.charCodeAt(0) === 0xFEFF) {
            cleanJsonStr = cleanJsonStr.slice(1);
            console.log('移除了UTF-8 BOM前缀');
        }
        
        // 如果JSON字符串有非标准字符前缀，尝试找到第一个JSON有效字符
        let startPos = 0;
        while (startPos < cleanJsonStr.length && 
               !['[', '{', '"', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-'].includes(cleanJsonStr[startPos])) {
            startPos++;
        }
        
        if (startPos > 0) {
            console.log(`移除了${startPos}个非JSON前缀字符`);
            cleanJsonStr = cleanJsonStr.slice(startPos);
        }
        
        // 查找额外字符可能附加在JSON后面
        let endPos = cleanJsonStr.length - 1;
        let foundEnd = false;
        
        // 尝试找到最后一个JSON结束字符 ('}' 或 ']')
        for (let i = cleanJsonStr.length - 1; i >= 0; i--) {
            if (cleanJsonStr[i] === '}' || cleanJsonStr[i] === ']') {
                endPos = i;
                foundEnd = true;
                break;
            }
        }
        
        if (foundEnd && endPos < cleanJsonStr.length - 1) {
            console.log(`移除了${cleanJsonStr.length - endPos - 1}个非JSON后缀字符`);
            cleanJsonStr = cleanJsonStr.slice(0, endPos + 1);
        }
        
        // 尝试直接解析清理后的JSON
        try {
            return JSON.parse(cleanJsonStr);
        } catch (directError) {
            console.warn('直接解析JSON失败，尝试使用正则表达式:', directError.message);
            
            // 尝试用正则表达式找到有效的JSON对象或数组
            const objMatch = cleanJsonStr.match(/(\{.*\})/s);
            const arrMatch = cleanJsonStr.match(/(\[.*\])/s);
            
            if (objMatch && objMatch[1]) {
                try {
                    const data = JSON.parse(objMatch[1]);
                    console.log('使用正则提取JSON对象成功');
                    return data;
                } catch (e) {
                    console.error('正则提取的JSON对象解析失败:', e);
                }
            }
            
            if (arrMatch && arrMatch[1]) {
                try {
                    const data = JSON.parse(arrMatch[1]);
                    console.log('使用正则提取JSON数组成功');
                    return data;
                } catch (e) {
                    console.error('正则提取的JSON数组解析失败:', e);
                }
            }
            
            // 尝试逐字符分析修复JSON
            console.log('尝试高级JSON修复');
            try {
                // 寻找开始的 { 或 [
                let start = cleanJsonStr.indexOf('{');
                if (start === -1) start = cleanJsonStr.indexOf('[');
                if (start === -1) {
                    console.error('找不到JSON开始标记');
                    return null;
                }
                
                // 找到对应的结束括号
                let end = -1;
                let openBrackets = 0;
                let inString = false;
                let escapeNext = false;
                
                for (let i = start; i < cleanJsonStr.length; i++) {
                    const c = cleanJsonStr[i];
                    
                    if (escapeNext) {
                        escapeNext = false;
                        continue;
                    }
                    
                    if (c === '\\' && inString) {
                        escapeNext = true;
                        continue;
                    }
                    
                    if (c === '"' && !escapeNext) {
                        inString = !inString;
                        continue;
                    }
                    
                    if (inString) continue;
                    
                    if (c === '{' || c === '[') {
                        openBrackets++;
                    } else if (c === '}' || c === ']') {
                        openBrackets--;
                        if (openBrackets === 0) {
                            end = i;
                            break;
                        }
                    }
                }
                
                if (end === -1) {
                    console.error('找不到匹配的JSON结束标记');
                    return null;
                }
                
                const extractedJson = cleanJsonStr.substring(start, end + 1);
                console.log('提取出可能的JSON:', extractedJson.substring(0, 30) + '...');
                
                return JSON.parse(extractedJson);
            } catch (advancedError) {
                console.error('高级JSON修复失败:', advancedError);
                return null;
            }
        }
    } catch (err) {
        console.error('解析JSON失败:', err);
        return null;
    }
}

// 发送同步数据给对等点
function sendSyncData(wire) {
    try {
        if (!wire) {
            console.error('无法发送同步数据: wire对象为空');
            return;
        }
        
        if (typeof wire.sendMessage !== 'function') {
            console.error('无法发送同步数据: sendMessage不是函数', wire);
            return;
        }
        
        console.log('正在发送同步数据给对等点:', wire.peerId);
        
        const syncData = {
            type: 'sync',
            from: myPeerId,
            tableData: tableData,
            ungroupedMembers: ungroupedMembers,
            timestamp: Date.now()
        };
        
        // 先尝试使用wire.sendMessage
        try {
            wire.sendMessage(syncData);
        } catch (err) {
            console.error('使用sendMessage发送数据失败:', err);
            
            // 失败后尝试备用方法 - 直接使用extended和扩展ID
            try {
                const jsonStr = JSON.stringify(syncData);
                const encoder = new TextEncoder();
                const buf = encoder.encode(jsonStr);
                
                // 尝试两种不同扩展发送方式
                if (wire.peerExtendedMapping && wire.peerExtendedMapping.messageChannel) {
                    console.log('尝试通过扩展ID发送数据');
                    wire.extended(wire.peerExtendedMapping.messageChannel, buf);
                } else {
                    console.log('尝试通过扩展名发送数据');
                    wire.extended('messageChannel', buf);
                }
            } catch (backupErr) {
                console.error('备用方法发送数据也失败:', backupErr);
            }
        }
    } catch (err) {
        console.error('同步数据操作失败:', err);
    }
}

// 广播数据给所有连接的对等点
function broadcastData(data) {
    try {
        // 添加发送者ID和时间戳
        data.from = myPeerId;
        data.timestamp = Date.now();
        
        console.log('正在广播数据给所有对等点:', Object.keys(connectedPeers).length);
        
        // 遍历所有连接的对等点
        Object.values(connectedPeers).forEach(wire => {
            try {
                if (!wire) {
                    console.warn('跳过无效的wire对象');
                    return;
                }
                
                // 使用sendSyncData而不是直接调用sendMessage
                // 这样可以利用sendSyncData中的错误处理和备用方法
                if (wire.peerId) {
                    console.log('广播数据给对等点:', wire.peerId);
                    
                    // 创建副本以防止跨发送修改
                    const dataCopy = JSON.parse(JSON.stringify(data));
                    
                    if (typeof wire.sendMessage === 'function') {
                        wire.sendMessage(dataCopy);
                    } else {
                        console.warn('对等点不支持sendMessage方法:', wire.peerId);
                        
                        // 尝试备用方法
                        try {
                            const jsonStr = JSON.stringify(dataCopy);
                            const encoder = new TextEncoder();
                            const buf = encoder.encode(jsonStr);
                            
                            if (wire.peerExtendedMapping && wire.peerExtendedMapping.messageChannel) {
                                wire.extended(wire.peerExtendedMapping.messageChannel, buf);
                            } else {
                                wire.extended('messageChannel', buf);
                            }
                        } catch (extErr) {
                            console.error('使用extended方法广播失败:', extErr);
                        }
                    }
                }
            } catch (peerErr) {
                console.error('向特定对等点广播失败:', peerErr);
                // 继续处理下一个对等点
            }
        });
    } catch (err) {
        console.error('广播数据过程中发生错误:', err);
    }
}

// 更新连接用户列表
function updatePeerList() {
    peerList.innerHTML = '';
    
    const peerCount = Object.keys(connectedPeers).length;
    
    // 更新连接数量显示
    const connectionsCount = document.getElementById('connections-count');
    if (connectionsCount) {
        if (peerCount > 0) {
            connectionsCount.textContent = `已连接 ${peerCount} 个用户`;
            connectionsCount.style.color = '#0288d1';
        } else {
            connectionsCount.textContent = '等待其他用户连接...';
            connectionsCount.style.color = '#999';
        }
    }
    
    if (peerCount > 0) {
        // 显示连接用户信息
        Object.keys(connectedPeers).forEach(peerId => {
            const peerElement = document.createElement('div');
            peerElement.className = 'peer-tag';
            // 显示ID的一部分
            peerElement.textContent = peerId.substring(0, 8);
            peerElement.title = peerId;
            peerList.appendChild(peerElement);
        });
    } else {
        // 显示等待连接信息
        const waitingElement = document.createElement('div');
        waitingElement.className = 'waiting-message';
        waitingElement.textContent = '当前没有其他用户连接';
        waitingElement.style.color = '#999';
        waitingElement.style.padding = '10px';
        waitingElement.style.textAlign = 'center';
        peerList.appendChild(waitingElement);
    }
    
    // 更新连接状态显示
    if (webtorrentInitialized) {
        connectionStatus.textContent = peerCount > 0 
            ? `已连接到房间 (${peerCount}人在线)` 
            : '已连接到房间，等待他人加入';
        
        connectionStatus.classList.add('connected');
    }
}

// 渲染表格
function renderTable() {
    // 清空表格内容
    tableBody.innerHTML = '';
    
    // 如果没有数据，显示提示
    if (tableData.rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.textContent = '暂无分组数据，请点击"添加新分组"按钮创建';
        td.style.textAlign = 'center';
        td.style.padding = '30px';
        td.style.color = '#7f8c8d';
        tr.appendChild(td);
        tableBody.appendChild(tr);
        return;
    }
    
    // 渲染表格内容
    tableData.rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.dataset.rowId = row.id;
        
        // 组名单元格
        const nameTd = document.createElement('td');
        nameTd.className = 'group-name-cell';
        
        // 组名和计数
        const nameSpan = document.createElement('span');
        nameSpan.textContent = row['组名'] || '';
        nameTd.appendChild(nameSpan);
        
        // 添加人数计数
        const membersArray = row['成员'] ? row['成员'].split(',').filter(m => m.trim()) : [];
        const countSpan = document.createElement('span');
        countSpan.className = 'group-count';
        countSpan.textContent = membersArray.length + '人';
        nameTd.appendChild(countSpan);
        
        // 双击编辑组名
        nameTd.addEventListener('dblclick', () => startEditing(nameTd, row.id, '组名'));
        tr.appendChild(nameTd);
        
        // 成员单元格
        const membersTd = document.createElement('td');
        membersTd.className = 'members-cell';
        
        // 创建成员列表
        const membersList = document.createElement('div');
        membersList.className = 'members-list';
        
        if (membersArray.length > 0) {
            membersArray.forEach(member => {
                if (member.trim()) {
                    const memberTag = document.createElement('span');
                    memberTag.className = 'member-tag';
                    memberTag.textContent = member.trim();
                    memberTag.addEventListener('click', () => removeMemberFromGroup(row.id, member.trim()));
                    membersList.appendChild(memberTag);
                }
            });
        } else {
            membersList.textContent = '暂无成员';
            membersList.style.color = '#999';
        }
        
        membersTd.appendChild(membersList);
        tr.appendChild(membersTd);
        
        // 操作按钮单元格
        const actionsTd = document.createElement('td');
        actionsTd.className = 'actions-cell';
        
        const actionButtons = document.createElement('div');
        actionButtons.className = 'action-buttons';
        
        // 添加成员按钮
        const addMemberBtn = document.createElement('button');
        addMemberBtn.textContent = '添加成员';
        addMemberBtn.className = 'add-member-btn';
        addMemberBtn.addEventListener('click', () => addMemberToGroup(row.id));
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '删除分组';
        deleteBtn.className = 'delete-btn';
        deleteBtn.addEventListener('click', () => deleteRowFromTable(row.id));
        
        actionButtons.appendChild(addMemberBtn);
        actionButtons.appendChild(deleteBtn);
        actionsTd.appendChild(actionButtons);
        tr.appendChild(actionsTd);
        
        tableBody.appendChild(tr);
    });
}

// 渲染未分组成员
function renderUngroupedMembers() {
    ungroupedList.innerHTML = '';
    
    if (ungroupedMembers.length === 0) {
        return; // 使用CSS的:empty伪类显示提示文字
    }
    
    ungroupedMembers.forEach(member => {
        const memberTag = document.createElement('span');
        memberTag.className = 'member-tag unassigned-tag';
        memberTag.textContent = member;
        memberTag.addEventListener('click', () => handleUngroupedMemberClick(member));
        
        ungroupedList.appendChild(memberTag);
    });
}

// 处理未分组成员点击
function handleUngroupedMemberClick(member) {
    const action = confirm(`请选择操作:\n点击"确定"将 ${member} 添加到分组\n点击"取消"从未分组列表中删除`);
    
    if (action) {
        // 添加到组
        if (tableData.rows.length === 0) {
            alert('暂无可用分组，请先创建分组');
            return;
        }
        
        // 创建组选择菜单
        let groupOptions = '';
        tableData.rows.forEach(row => {
            groupOptions += `<option value="${row.id}">${row['组名']}</option>`;
        });
        
        const selectHtml = `
            <label for="select-group">选择要添加到的组:</label><br>
            <select id="select-group">${groupOptions}</select>
        `;
        
        // 使用自定义对话框
        const dialogContainer = document.createElement('div');
        dialogContainer.className = 'export-overlay';
        dialogContainer.innerHTML = `
            <div class="export-modal">
                <div class="export-header">
                    <h3>选择分组</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="export-content">
                    ${selectHtml}
                </div>
                <div class="export-buttons">
                    <button class="primary-btn" id="confirm-group">确定</button>
                    <button class="delete-btn" id="cancel-group">取消</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialogContainer);
        
        // 处理对话框事件
        document.querySelector('.close-modal').addEventListener('click', () => {
            document.body.removeChild(dialogContainer);
        });
        
        document.getElementById('cancel-group').addEventListener('click', () => {
            document.body.removeChild(dialogContainer);
        });
        
        document.getElementById('confirm-group').addEventListener('click', () => {
            const selectedGroupId = document.getElementById('select-group').value;
            if (selectedGroupId) {
                moveUngroupedToGroup(member, selectedGroupId);
            }
            document.body.removeChild(dialogContainer);
        });
    } else {
        // 删除
        if (confirm(`确定要删除 ${member} 吗？`)) {
            removeUngroupedMember(member);
        }
    }
}

// 将未分组成员移动到组
function moveUngroupedToGroup(member, groupId) {
    const index = ungroupedMembers.indexOf(member);
    if (index !== -1) {
        // 从未分组列表中移除
        ungroupedMembers.splice(index, 1);
        renderUngroupedMembers();
        
        // 添加到选中的组
        const rowIndex = tableData.rows.findIndex(row => row.id === groupId);
        if (rowIndex !== -1) {
            const currentMembers = tableData.rows[rowIndex]['成员'] 
                ? tableData.rows[rowIndex]['成员'].split(',').filter(m => m.trim()) 
                : [];
                
            currentMembers.push(member);
            tableData.rows[rowIndex]['成员'] = currentMembers.join(',');
            renderTable();
            saveToLocalStorage();
            
            // 广播移动到组事件
            broadcastData({
                type: 'moveToGroup',
                member: member,
                groupId: groupId
            });
        }
    }
}

// 开始编辑单元格
function startEditing(cell, rowId, column) {
    // 已经在编辑中
    if (cell.classList.contains('editing')) {
        return;
    }
    
    // 获取组名文本
    const nameSpan = cell.querySelector('span:first-child');
    const currentValue = nameSpan.textContent;
    
    cell.classList.add('editing');
    
    // 保存原始内容，用于恢复
    const originalContent = cell.innerHTML;
    
    cell.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    cell.appendChild(input);
    
    input.focus();
    
    input.addEventListener('blur', () => finishEditing(cell, rowId, column, input.value, originalContent));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            finishEditing(cell, rowId, column, input.value, originalContent);
        } else if (e.key === 'Escape') {
            cell.classList.remove('editing');
            cell.innerHTML = originalContent;
        }
    });
}

// 完成编辑
function finishEditing(cell, rowId, column, newValue, originalContent) {
    if (!newValue.trim()) {
        cell.classList.remove('editing');
        cell.innerHTML = originalContent;
        return;
    }
    
    cell.classList.remove('editing');
    
    updateRowInTable(rowId, column, newValue);
    
    // 广播编辑组名事件
    broadcastData({
        type: 'editGroupName',
        groupId: rowId,
        newName: newValue
    });
}

// 更新行数据
function updateRowInTable(rowId, column, newValue) {
    const rowIndex = tableData.rows.findIndex(row => row.id === rowId);
    
    if (rowIndex >= 0) {
        tableData.rows[rowIndex][column] = newValue;
        renderTable();
        saveToLocalStorage();
    }
}

// 从表格删除行
function deleteRowFromTable(rowId) {
    if (!confirm('确定要删除这个分组吗？')) return;
    
    const rowIndex = tableData.rows.findIndex(row => row.id === rowId);
    
    if (rowIndex >= 0) {
        // 询问是否将成员移至未分组
        const row = tableData.rows[rowIndex];
        const members = row['成员'] ? row['成员'].split(',').filter(m => m.trim()) : [];
        
        let keepMembers = false;
        
        // 记录组ID，用于广播
        const groupId = row.id;
        
        // 删除组
        tableData.rows.splice(rowIndex, 1);
        renderTable();
        saveToLocalStorage();
        
        // 广播删除组事件
        broadcastData({
            type: 'deleteGroup',
            groupId: groupId,
            keepMembers: keepMembers
        });
    }
}

// 向分组添加成员
function addMemberToGroup(rowId) {
    const rowIndex = tableData.rows.findIndex(row => row.id === rowId);
    if (rowIndex === -1) return;
    
    // 如果有未分组成员，显示选择对话框
    if (ungroupedMembers.length > 0) {
        const memberName = prompt('输入成员姓名或从未分组成员中选择（' + ungroupedMembers.join('、') + '）:');
        if (!memberName || !memberName.trim()) return;
        
        // 如果该成员在未分组列表中，将其移除
        const memberIndex = ungroupedMembers.indexOf(memberName.trim());
        if (memberIndex >= 0) {
            ungroupedMembers.splice(memberIndex, 1);
            renderUngroupedMembers();
            
            // 广播移除未分组成员事件
            broadcastData({
                type: 'removeUngrouped',
                member: memberName.trim()
            });
        }
        
        addMemberToGroupImpl(rowId, memberName.trim());
    } else {
        const memberName = prompt('请输入成员姓名:');
        if (!memberName || !memberName.trim()) return;
        
        addMemberToGroupImpl(rowId, memberName.trim());
    }
}

// 实际添加成员到分组的通用函数
function addMemberToGroupImpl(rowId, memberName) {
    const rowIndex = tableData.rows.findIndex(row => row.id === rowId);
    if (rowIndex === -1) return;
    
    // 获取当前成员列表
    let currentMembers = tableData.rows[rowIndex]['成员'] 
        ? tableData.rows[rowIndex]['成员'].split(',').filter(m => m.trim()) 
        : [];
    
    // 检查是否已存在
    if (currentMembers.includes(memberName)) {
        alert('该成员已存在于分组中');
        return;
    }
    
    // 添加新成员
    currentMembers.push(memberName);
    tableData.rows[rowIndex]['成员'] = currentMembers.join(',');
    
    renderTable();
    saveToLocalStorage();
    
    // 广播添加成员事件
    broadcastData({
        type: 'addMember',
        groupId: rowId,
        member: memberName
    });
}

// 从分组中移除成员
function removeMemberFromGroup(rowId, memberName) {
    if (!confirm(`确定要从当前分组移除成员"${memberName}"吗？`)) return;
    
    const rowIndex = tableData.rows.findIndex(row => row.id === rowId);
    if (rowIndex === -1) return;
    
    // 获取当前成员列表
    let currentMembers = tableData.rows[rowIndex]['成员'] 
        ? tableData.rows[rowIndex]['成员'].split(',').filter(m => m.trim()) 
        : [];
    
    // 移除成员
    const updatedMembers = currentMembers.filter(m => m !== memberName);
    tableData.rows[rowIndex]['成员'] = updatedMembers.join(',');
    
    renderTable();
    saveToLocalStorage();
    
    // 询问是否将成员移动到未分组列表
        // 只广播移除成员事件
        broadcastData({
            type: 'removeMember',
            groupId: rowId,
            member: memberName
        });
}

// 添加未分组成员
function addUngroupedMember() {
    const memberName = newMemberInput.value.trim();
    if (!memberName) {
        alert('请输入成员姓名');
        return;
    }
    
    // 检查是否已存在
    if (ungroupedMembers.includes(memberName)) {
        alert('该成员已存在于未分组列表中');
        return;
    }
    
    // 检查是否已在某个分组中
    let memberExists = false;
    tableData.rows.forEach(row => {
        const members = row['成员'] ? row['成员'].split(',').filter(m => m.trim()) : [];
        if (members.includes(memberName)) {
            memberExists = true;
            return;
        }
    });
    
    if (memberExists) {
        alert('该成员已存在于某个分组中');
        return;
    }
    
    // 添加到未分组列表
    ungroupedMembers.push(memberName);
    renderUngroupedMembers();
    saveToLocalStorage();
    newMemberInput.value = '';
    
    // 广播添加未分组成员事件
    broadcastData({
        type: 'addUngrouped',
        member: memberName
    });
}

// 从未分组列表移除成员
function removeUngroupedMember(member) {
    const index = ungroupedMembers.indexOf(member);
    if (index === -1) return;
    
    ungroupedMembers.splice(index, 1);
    renderUngroupedMembers();
    saveToLocalStorage();
    
    // 广播移除未分组成员事件
    broadcastData({
        type: 'removeUngrouped',
        member: member
    });
}

// 导出分组信息
function exportGroupData() {
    // 创建导出数据
    let exportData = {
        分组信息: tableData.rows.map(row => {
            return {
                组名: row['组名'],
                成员数量: row['成员'] ? row['成员'].split(',').filter(m => m.trim()).length : 0,
                成员列表: row['成员'] ? row['成员'].split(',').filter(m => m.trim()) : []
            };
        }),
        未分组成员: ungroupedMembers
    };
    
    // 创建导出文本
    const exportStr = JSON.stringify(exportData, null, 2);
    
    // 创建模态框
    const overlay = document.createElement('div');
    overlay.className = 'export-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'export-modal';
    
    // 模态框头部
    const header = document.createElement('div');
    header.className = 'export-header';
    
    const title = document.createElement('h3');
    title.textContent = '导出分组信息';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-modal';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => document.body.removeChild(overlay));
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    // 模态框内容
    const content = document.createElement('div');
    content.className = 'export-content';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'export-textarea';
    textarea.value = exportStr;
    textarea.readOnly = true;
    
    content.appendChild(textarea);
    
    // 模态框按钮
    const buttons = document.createElement('div');
    buttons.className = 'export-buttons';
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'primary-btn';
    copyBtn.textContent = '复制到剪贴板';
    copyBtn.addEventListener('click', () => {
        textarea.select();
        document.execCommand('copy');
        alert('已复制到剪贴板');
    });
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'export-btn';
    downloadBtn.textContent = '下载JSON文件';
    downloadBtn.addEventListener('click', () => {
        const blob = new Blob([exportStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '分组信息_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
    
    buttons.appendChild(copyBtn);
    buttons.appendChild(downloadBtn);
    
    // 组装模态框
    modal.appendChild(header);
    modal.appendChild(content);
    modal.appendChild(buttons);
    overlay.appendChild(modal);
    
    document.body.appendChild(overlay);
}

// 保存到本地存储
function saveToLocalStorage() {
    localStorage.setItem('groupTableData', JSON.stringify(tableData));
    localStorage.setItem('ungroupedMembers', JSON.stringify(ungroupedMembers));
    
    // 显示保存成功消息
    const saveBtn = document.getElementById('save-local');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '✓ 已保存';
    saveBtn.style.backgroundColor = '#27ae60';
    
    setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.backgroundColor = '';
    }, 2000);
}

// 从本地存储加载
function loadFromLocalStorage() {
    const savedData = localStorage.getItem('groupTableData');
    const savedUngrouped = localStorage.getItem('ungroupedMembers');
    
    if (savedData) {
        try {
            tableData = JSON.parse(savedData);
        } catch (e) {
            console.error('加载分组数据失败:', e);
        }
    }
    
    if (savedUngrouped) {
        try {
            ungroupedMembers = JSON.parse(savedUngrouped);
        } catch (e) {
            console.error('加载未分组成员失败:', e);
            ungroupedMembers = [];
        }
    }
}

// 加载已保存的数据并更新UI
function loadStoredData() {
    if (confirm('确定要加载保存的数据吗？这将覆盖当前分组数据。')) {
        loadData();
        renderTable();
        renderUngroupedMembers();
        
        // 广播更新给连接的用户
        broadcastData({
            type: 'sync',
            tableData: tableData,
            ungroupedMembers: ungroupedMembers
        });
        
        alert('数据已加载');
    }
}

// 处理接收到的数据
function handleDataReceived(data, wire) {
    try {
        if (!data) {
            console.warn('收到的数据为空');
            return;
        }
        
        console.log('收到数据类型:', data.type, '来自:', data.from);
        
        // 忽略自己发送的消息
        if (data.from === myPeerId) {
            console.log('忽略自己发送的消息');
            return;
        }
        
        // 检查时间戳，忽略较旧的消息
        const now = Date.now();
        if (data.timestamp && (now - data.timestamp > 120000)) {
            console.log('忽略2分钟前的过期消息');
            return;
        }
        
        if (data.type === 'sync') {
            // 完整数据同步
            console.log('接收到同步数据，表格行数:', data.tableData?.rows?.length);
            
            // 如果接收到的数据为空，但本地已有数据，不进行覆盖
            if ((!data.tableData || data.tableData.rows.length === 0) && 
                tableData && tableData.rows && tableData.rows.length > 0) {
                console.log('收到空数据但本地有数据，忽略此同步');
                
                // 反向发送我们的数据给发送者
                if (wire && wire.sendMessage) {
                    console.log('发送我们的数据回给对方');
                    setTimeout(() => {
                        sendSyncData(wire);
                    }, 1000);
                }
                return;
            }
            
            tableData = data.tableData;
            ungroupedMembers = data.ungroupedMembers;
            renderTable();
            renderUngroupedMembers();
            
            // 只有在收到有效数据后才保存到本地
            if (tableData && tableData.rows && tableData.rows.length > 0) {
                saveToLocalStorage();
                console.log('已同步并保存外部数据');
                
                // 标记不再是新用户
                window.isNewUser = false;
            }
            
            // 回复一个确认收到的消息
            if (wire && wire.sendMessage) {
                wire.sendMessage({
                    type: 'syncAck',
                    from: myPeerId,
                    timestamp: Date.now(),
                    message: '已收到数据同步'
                });
            }
        } else if (data.type === 'syncRequest') {
            // 同步请求 - 有新客户端连接，发送当前数据
            console.log('收到同步请求，发送当前数据');
            // 只有当本地有数据时才发送同步数据
            if (tableData && tableData.rows && tableData.rows.length > 0) {
                if (wire && wire.sendMessage) {
                    sendSyncData(wire);
                }
            } else {
                console.log('本地无数据，不响应同步请求');
            }
        } else if (data.type === 'syncAck') {
            // 同步确认 - 无需操作，仅记录
            console.log('接收到同步确认:', data.message);
        } else if (data.type === 'addGroup') {
            // 添加新组
            if (data.group && data.group.id) {
                // 检查组是否已存在
                const existingIndex = tableData.rows.findIndex(row => row.id === data.group.id);
                if (existingIndex === -1) {
                    tableData.rows.push(data.group);
                    renderTable();
                    saveToLocalStorage();
                } else {
                    console.log('跳过已存在的组:', data.group.id);
                }
            }
        } else if (data.type === 'editGroupName') {
            // 编辑组名
            const rowIndex = tableData.rows.findIndex(row => row.id === data.groupId);
            if (rowIndex !== -1) {
                tableData.rows[rowIndex]['组名'] = data.newName;
                renderTable();
                saveToLocalStorage();
            }
        } else if (data.type === 'deleteGroup') {
            // 删除组
            const rowIndex = tableData.rows.findIndex(row => row.id === data.groupId);
            if (rowIndex !== -1) {
                // 如果需要保留成员，则添加到未分组列表
                if (data.keepMembers) {
                    const members = tableData.rows[rowIndex]['成员'] 
                        ? tableData.rows[rowIndex]['成员'].split(',').filter(m => m.trim()) 
                        : [];
                    ungroupedMembers.push(...members);
                    renderUngroupedMembers();
                }
                
                tableData.rows.splice(rowIndex, 1);
                renderTable();
                saveToLocalStorage();
            }
        } else if (data.type === 'addMember') {
            // 添加成员到组
            const rowIndex = tableData.rows.findIndex(row => row.id === data.groupId);
            if (rowIndex !== -1) {
                const currentMembers = tableData.rows[rowIndex]['成员'] 
                    ? tableData.rows[rowIndex]['成员'].split(',').filter(m => m.trim()) 
                    : [];
                
                if (!currentMembers.includes(data.member)) {
                    currentMembers.push(data.member);
                    tableData.rows[rowIndex]['成员'] = currentMembers.join(',');
                    renderTable();
                    saveToLocalStorage();
                }
            }
        } else if (data.type === 'removeMember') {
            // 从组中移除成员
            const rowIndex = tableData.rows.findIndex(row => row.id === data.groupId);
            if (rowIndex !== -1) {
                const currentMembers = tableData.rows[rowIndex]['成员'] 
                    ? tableData.rows[rowIndex]['成员'].split(',').filter(m => m.trim()) 
                    : [];
                
                const updatedMembers = currentMembers.filter(m => m !== data.member);
                tableData.rows[rowIndex]['成员'] = updatedMembers.join(',');
                renderTable();
                saveToLocalStorage();
            }
        } else if (data.type === 'addUngrouped') {
            // 添加未分组成员
            if (!ungroupedMembers.includes(data.member)) {
                ungroupedMembers.push(data.member);
                renderUngroupedMembers();
                saveToLocalStorage();
            }
        } else if (data.type === 'removeUngrouped') {
            // 删除未分组成员
            const index = ungroupedMembers.indexOf(data.member);
            if (index !== -1) {
                ungroupedMembers.splice(index, 1);
                renderUngroupedMembers();
                saveToLocalStorage();
            }
        } else if (data.type === 'moveToGroup') {
            // 将未分组成员移动到组
            const index = ungroupedMembers.indexOf(data.member);
            if (index !== -1) {
                ungroupedMembers.splice(index, 1);
                
                const rowIndex = tableData.rows.findIndex(row => row.id === data.groupId);
                if (rowIndex !== -1) {
                    const currentMembers = tableData.rows[rowIndex]['成员'] 
                        ? tableData.rows[rowIndex]['成员'].split(',').filter(m => m.trim()) 
                        : [];
                    
                    currentMembers.push(data.member);
                    tableData.rows[rowIndex]['成员'] = currentMembers.join(',');
                }
                
                renderTable();
                renderUngroupedMembers();
                saveToLocalStorage();
            }
        } else {
            console.warn('未知的消息类型:', data.type);
        }
    } catch (err) {
        console.error('处理接收数据时出错:', err);
    }
}

// 加载数据
function loadData() {
    const savedData = localStorage.getItem('groupTableData');
    const savedUngrouped = localStorage.getItem('ungroupedMembers');
    
    if (savedData) {
        try {
            tableData = JSON.parse(savedData);
        } catch (e) {
            console.error('加载分组数据失败:', e);
            tableData = { columns: ['组名', '成员'], rows: [] };
        }
    } else {
        tableData = { columns: ['组名', '成员'], rows: [] };
    }
    
    if (savedUngrouped) {
        try {
            ungroupedMembers = JSON.parse(savedUngrouped);
        } catch (e) {
            console.error('加载未分组成员失败:', e);
            ungroupedMembers = [];
        }
    } else {
        ungroupedMembers = [];
    }
}

// 保存数据
function saveData() {
    saveToLocalStorage();
    
    // 显示保存成功消息
    const saveBtn = document.getElementById('save-local');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '✓ 已保存';
    saveBtn.style.backgroundColor = '#27ae60';
    
    // 广播当前数据
    broadcastData({
        type: 'sync',
        tableData: tableData,
        ungroupedMembers: ungroupedMembers
    });
    
    setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.backgroundColor = '';
    }, 2000);
}

// 添加新组
function addNewGroup() {
    const newRow = {
        id: uuid.v4(),
        '组名': '组 ' + (tableData.rows.length + 1),
        '成员': ''
    };
    
    tableData.rows.push(newRow);
    renderTable();
    saveToLocalStorage();
    
    // 广播添加组事件
    broadcastData({
        type: 'addGroup',
        group: newRow
    });
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', init); 