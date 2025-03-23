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
const joinRoomBtn = document.getElementById('join-room');
const peerList = document.getElementById('peer-list');

// 初始化函数
function init() {
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
    
    // WebTorrent连接事件
    joinRoomBtn.addEventListener('click', joinRoom);
    
    // 从localStorage加载数据
    loadData();
    
    // 渲染表格和未分组成员
    renderTable();
    renderUngroupedMembers();
    
    // 初始化WebTorrent
    initWebTorrent();
    
    // 生成唯一的对等点ID
    myPeerId = generatePeerId();
}

// 生成唯一的对等点ID
function generatePeerId() {
    return 'peer-' + Math.random().toString(36).substr(2, 9);
}

// 初始化WebTorrent
function initWebTorrent() {
    try {
        // 创建WebTorrent客户端
        client = new WebTorrent();
        connectionStatus.textContent = '准备就绪，请输入房间ID并加入';
        
        // 设置WebTorrent事件监听
        client.on('error', (err) => {
            console.error('WebTorrent错误:', err);
            connectionStatus.textContent = '连接错误: ' + err.message;
            connectionStatus.classList.remove('connected');
        });
        
        // 使用之前保存的房间ID(如果有)
        const savedRoomId = localStorage.getItem('roomId');
        if (savedRoomId) {
            roomIdInput.value = savedRoomId;
        }
        
    } catch (err) {
        console.error('初始化WebTorrent失败:', err);
        connectionStatus.textContent = 'WebTorrent初始化失败';
    }
}

// 加入房间
function joinRoom() {
    if (!client) {
        alert('WebTorrent客户端未初始化，请刷新页面重试');
        return;
    }
    
    // 获取房间ID
    roomId = roomIdInput.value.trim();
    if (!roomId) {
        alert('请输入有效的房间ID');
        return;
    }
    
    // 保存房间ID到本地存储
    localStorage.setItem('roomId', roomId);
    
    connectionStatus.textContent = '正在连接到房间...';
    
    // 创建种子的磁力链接/信息哈希
    // 我们使用房间ID作为种子的唯一标识符
    const magnetURI = `magnet:?xt=urn:btih:${roomId}`;
    
    // 检查是否已经有对应的种子
    if (torrent) {
        // 如果已有种子，先移除
        client.remove(torrent);
        connectedPeers = {};
        updatePeerList();
    }
    
    try {
        // 使用WebTorrent加入/创建对应的种子
        client.seed(new Blob([JSON.stringify({
            id: myPeerId,
            time: Date.now()
        })]), { 
            name: roomId,
            announce: [
                'wss://tracker.openwebtorrent.com',
                'wss://tracker.btorrent.xyz'
            ]
        }, (seed) => {
            torrent = seed;
            console.log('创建种子成功:', torrent.magnetURI);
            
            // 设置种子事件监听
            setupTorrentEvents(torrent);
            
            // 同时也加入这个种子以接收其他对等点的数据
            client.add(magnetURI, { announce: [
                'wss://tracker.openwebtorrent.com',
                'wss://tracker.btorrent.xyz'
            ]}, (download) => {
                // 如果是新的种子，设置事件监听
                if (download !== torrent) {
                    setupTorrentEvents(download);
                }
            });
            
            connectionStatus.textContent = '已连接到房间';
            connectionStatus.classList.add('connected');
        });
    } catch (err) {
        console.error('加入房间失败:', err);
        connectionStatus.textContent = '加入房间失败: ' + err.message;
    }
}

// 设置种子事件监听
function setupTorrentEvents(t) {
    // 对等点连接事件
    t.on('wire', (wire) => {
        console.log('新的对等点连接:', wire.peerId);
        
        // 设置数据通道
        wire.use(setupMessageChannel(wire));
        
        // 更新对等点列表
        if (wire.peerId && !connectedPeers[wire.peerId]) {
            connectedPeers[wire.peerId] = wire;
            updatePeerList();
            
            // 发送当前数据给新连接的对等点
            setTimeout(() => {
                sendSyncData(wire);
            }, 1000); // 稍微延迟以确保连接稳定
        }
    });
    
    // 对等点断开连接事件
    t.on('wire-disconnect', (wire) => {
        console.log('对等点断开连接:', wire.peerId);
        
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
}

// 设置消息通道
function setupMessageChannel(wire) {
    return function(wire) {
        // 实现自定义消息协议
        wire.extendedHandshake.messageChannel = true;
        
        // 接收到扩展握手
        wire.on('extended', (ext, buf) => {
            if (ext === 'message') {
                try {
                    const data = JSON.parse(buf.toString());
                    handleDataReceived(data, wire);
                } catch (err) {
                    console.error('解析消息失败:', err);
                }
            }
        });
        
        // 添加发送消息的方法
        wire.sendMessage = (data) => {
            const buf = Buffer.from(JSON.stringify(data));
            wire.extended('message', buf);
        };
    };
}

// 发送同步数据给对等点
function sendSyncData(wire) {
    if (wire && wire.sendMessage) {
        const syncData = {
            type: 'sync',
            from: myPeerId,
            tableData: tableData,
            ungroupedMembers: ungroupedMembers
        };
        wire.sendMessage(syncData);
    }
}

// 广播数据给所有连接的对等点
function broadcastData(data) {
    data.from = myPeerId; // 添加发送者ID
    
    Object.values(connectedPeers).forEach(wire => {
        if (wire && wire.sendMessage) {
            wire.sendMessage(data);
        }
    });
}

// 更新连接用户列表
function updatePeerList() {
    peerList.innerHTML = '';
    
    const peerCount = Object.keys(connectedPeers).length;
    if (peerCount > 0) {
        // 显示连接用户数量
        const countInfo = document.createElement('div');
        countInfo.textContent = `已连接 ${peerCount} 个用户`;
        countInfo.style.marginBottom = '8px';
        countInfo.style.color = '#0288d1';
        peerList.appendChild(countInfo);
    }
    
    Object.keys(connectedPeers).forEach(peerId => {
        const peerElement = document.createElement('div');
        peerElement.className = 'peer-tag';
        // 显示ID的一部分
        peerElement.textContent = peerId.substring(0, 8);
        peerElement.title = peerId;
        peerList.appendChild(peerElement);
    });
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
        if (members.length > 0) {
            keepMembers = confirm('是否将该分组的成员移至未分组列表？');
            
            if (keepMembers) {
                ungroupedMembers.push(...members);
                renderUngroupedMembers();
            }
        }
        
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
    if (confirm(`是否将 ${memberName} 移动到未分组列表？`)) {
        ungroupedMembers.push(memberName);
        renderUngroupedMembers();
        
        // 广播移除成员和添加到未分组事件
        broadcastData({
            type: 'removeMember',
            groupId: rowId,
            member: memberName
        });
        
        broadcastData({
            type: 'addUngrouped',
            member: memberName
        });
    } else {
        // 只广播移除成员事件
        broadcastData({
            type: 'removeMember',
            groupId: rowId,
            member: memberName
        });
    }
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
    console.log('收到数据:', data);
    
    // 忽略自己发送的消息
    if (data.from === myPeerId) {
        return;
    }
    
    if (data.type === 'sync') {
        // 完整数据同步
        tableData = data.tableData;
        ungroupedMembers = data.ungroupedMembers;
        renderTable();
        renderUngroupedMembers();
        
        // 保存到本地存储
        saveToLocalStorage();
    } else if (data.type === 'addGroup') {
        // 添加新组
        tableData.rows.push(data.group);
        renderTable();
        saveToLocalStorage();
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