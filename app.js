// 全局变量
let tableData = { // 表格数据
    columns: ['组名', '成员'], // 默认列
    rows: [] // 行数据
};
let ungroupedMembers = []; // 未分组成员列表

// DOM元素
const addGroupBtn = document.getElementById('add-group');
const saveLocalBtn = document.getElementById('save-local');
const loadLocalBtn = document.getElementById('load-local');
const exportDataBtn = document.getElementById('export-data');
const tableBody = document.getElementById('table-body');
const ungroupedList = document.getElementById('ungrouped-list');
const newMemberInput = document.getElementById('new-member-name');
const addUngroupedBtn = document.getElementById('add-ungrouped');

// 初始化函数
function init() {
    setupEventListeners();
    loadFromLocalStorage();
    renderTable();
    renderUngroupedMembers();
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
        memberTag.addEventListener('click', () => removeUngroupedMember(member));
        
        ungroupedList.appendChild(memberTag);
    });
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
    
    const rowData = {};
    rowData[column] = newValue;
    
    updateRowInTable(rowId, rowData);
}

// 向分组添加成员
function addMemberToGroup(rowId) {
    const row = tableData.rows.find(r => r.id === rowId);
    if (!row) return;
    
    // 如果有未分组成员，显示选择对话框
    if (ungroupedMembers.length > 0) {
        const memberName = prompt('输入成员姓名或从未分组成员中选择（' + ungroupedMembers.join('、') + '）:');
        if (!memberName || !memberName.trim()) return;
        
        // 如果该成员在未分组列表中，将其移除
        const memberIndex = ungroupedMembers.indexOf(memberName.trim());
        if (memberIndex >= 0) {
            ungroupedMembers.splice(memberIndex, 1);
            renderUngroupedMembers();
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
    const row = tableData.rows.find(r => r.id === rowId);
    if (!row) return;
    
    // 获取当前成员列表
    let currentMembers = row['成员'] ? row['成员'].split(',').filter(m => m.trim()) : [];
    
    // 检查是否已存在
    if (currentMembers.includes(memberName)) {
        alert('该成员已存在于分组中');
        return;
    }
    
    // 添加新成员
    currentMembers.push(memberName);
    
    // 更新行数据
    const updatedMembers = currentMembers.join(',');
    updateRowInTable(rowId, { '成员': updatedMembers });
    
    saveToLocalStorage();
}

// 从分组中移除成员
function removeMemberFromGroup(rowId, memberName) {
    if (!confirm(`确定要从当前分组移除成员"${memberName}"吗？`)) return;
    
    const row = tableData.rows.find(r => r.id === rowId);
    if (!row) return;
    
    // 获取当前成员列表
    let currentMembers = row['成员'] ? row['成员'].split(',').filter(m => m.trim()) : [];
    
    // 移除成员
    const updatedMembers = currentMembers.filter(m => m !== memberName);
    
    // 更新行数据
    const updatedMembersStr = updatedMembers.join(',');
    updateRowInTable(rowId, { '成员': updatedMembersStr });
    
    saveToLocalStorage();
}

// 添加未分组成员
function addUngroupedMember(name) {
    if (!name || !name.trim()) return;
    
    // 检查是否已存在
    if (ungroupedMembers.includes(name.trim())) {
        alert('该成员已存在于未分组列表中');
        return;
    }
    
    // 检查是否已在某个分组中
    let memberExists = false;
    tableData.rows.forEach(row => {
        const members = row['成员'] ? row['成员'].split(',').filter(m => m.trim()) : [];
        if (members.includes(name.trim())) {
            memberExists = true;
            return;
        }
    });
    
    if (memberExists) {
        alert('该成员已存在于某个分组中');
        return;
    }
    
    // 添加到未分组列表
    ungroupedMembers.push(name.trim());
    renderUngroupedMembers();
    saveToLocalStorage();
}

// 移除未分组成员
function removeUngroupedMember(name) {
    if (!confirm(`确定要移除未分组成员"${name}"吗？`)) return;
    
    const index = ungroupedMembers.indexOf(name);
    if (index >= 0) {
        ungroupedMembers.splice(index, 1);
        renderUngroupedMembers();
        saveToLocalStorage();
    }
}

// 添加行到表格
function addRowToTable() {
    const newRow = {
        id: uuid.v4(),
        '组名': '组 ' + (tableData.rows.length + 1),
        '成员': ''
    };
    
    tableData.rows.push(newRow);
    renderTable();
    saveToLocalStorage();
}

// 更新行数据
function updateRowInTable(rowId, rowData) {
    const rowIndex = tableData.rows.findIndex(row => row.id === rowId);
    
    if (rowIndex >= 0) {
        tableData.rows[rowIndex] = {
            ...tableData.rows[rowIndex],
            ...rowData
        };
        
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
        
        if (members.length > 0 && confirm('是否将该分组的成员移至未分组列表？')) {
            ungroupedMembers.push(...members);
            renderUngroupedMembers();
        }
        
        tableData.rows.splice(rowIndex, 1);
        renderTable();
        saveToLocalStorage();
    }
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

// 设置事件监听器
function setupEventListeners() {
    // 添加分组按钮
    addGroupBtn.addEventListener('click', () => {
        addRowToTable();
    });
    
    // 保存本地按钮
    saveLocalBtn.addEventListener('click', () => {
        saveToLocalStorage();
    });
    
    // 加载本地按钮
    loadLocalBtn.addEventListener('click', () => {
        if (confirm('确定要加载保存的数据吗？这将覆盖当前分组数据。')) {
            loadFromLocalStorage();
            renderTable();
            renderUngroupedMembers();
        }
    });
    
    // 导出数据按钮
    exportDataBtn.addEventListener('click', () => {
        exportGroupData();
    });
    
    // 添加未分组成员按钮
    addUngroupedBtn.addEventListener('click', () => {
        const name = newMemberInput.value.trim();
        if (name) {
            addUngroupedMember(name);
            newMemberInput.value = '';
        } else {
            alert('请输入成员姓名');
        }
    });
    
    // 未分组成员输入框回车事件
    newMemberInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const name = newMemberInput.value.trim();
            if (name) {
                addUngroupedMember(name);
                newMemberInput.value = '';
            } else {
                alert('请输入成员姓名');
            }
        }
    });
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', init); 