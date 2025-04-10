# 分组管理工具

一个简单易用的分组管理Web应用，适用于课程团队、项目小组等场景的成员分配和管理。通过WebTorrent技术实现多用户实时协作，完全无需服务器。

## 主要功能

- **去中心化协作**: 基于WebTorrent实现完全无服务器的P2P通信，所有用户直接连接
- **房间机制**: 输入相同房间ID的用户会自动连接到一起，实现分组协作
- **智能分组**: 创建、编辑、删除分组，并可为每个分组添加成员
- **成员统计**: 实时显示每个组的成员数量，直观了解分组情况
- **未分组成员管理**: 专门区域管理尚未分配的成员，方便后续分配
- **实时数据同步**: 所有用户的操作即时同步到所有连接的用户
- **数据导出**: 导出分组信息为JSON格式，便于存档或分享
- **本地存储**: 自动保存数据到浏览器本地存储，避免意外丢失
- **移动友好**: 响应式设计，在手机等小屏设备上同样可用

## 使用说明

### 连接和协作

1. 打开应用后，在页面顶部的房间ID输入框中输入一个房间名称
2. 点击"加入房间"按钮连接到该房间
3. 让其他用户也输入**相同的房间ID**并加入，即可建立连接
4. 页面顶部会显示当前连接状态和已连接的用户数量
5. 所有在同一房间的用户可以实时协作编辑分组数据

### 分组管理

1. 点击"添加新组"按钮创建新的分组
2. 双击组名可编辑组名称
3. 点击组内"+ 添加"按钮可为组添加成员
4. 点击成员标签可移除该成员或将其移至未分组列表
5. 点击组右侧的"删除"按钮可删除整个组

### 未分组成员管理

1. 在未分组区域输入姓名并点击"添加"按钮可添加未分组成员
2. 点击未分组成员标签，可将其添加到特定组或从列表中删除

### 数据操作

1. 点击"保存数据"按钮将当前分组数据保存到本地浏览器
2. 点击"导出数据"可将分组信息导出为JSON格式，支持复制或下载

## 技术详情

- 使用HTML5、CSS3和纯JavaScript开发，无需任何后端支持
- 基于WebTorrent和WebRTC技术实现完全去中心化的P2P通信
- 使用浏览器localStorage存储数据，确保刷新后数据不丢失
- 响应式设计支持各种屏幕尺寸的设备

## 注意事项

- 需要现代浏览器支持（Chrome、Firefox、Edge等）
- WebRTC连接可能受网络环境影响，如防火墙、NAT等
- 使用相同房间ID的所有用户将共享相同的数据
- 应用数据保存在本地，更换设备或清除浏览器数据将导致数据丢失
- 建议定期导出数据作为备份

## 隐私说明

应用完全在浏览器中运行，不需要任何中心化服务器。所有数据交换都在连接的用户之间直接进行，不经过第三方服务器。WebTorrent使用的WebRTC信令通道仅用于初始连接，不存储或处理任何用户数据。 