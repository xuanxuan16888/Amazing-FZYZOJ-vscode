// panelManager.js - 简化版，无 globalContext 依赖
const vscode = require('vscode');

class PanelManager {
  constructor() {
    this.panels = new Map();  // key: panelId, value: { panel, data }
  }

  /**
   * 获取或创建面板（单例�?
   */
  getOrCreate(panelId, title, viewColumn = vscode.ViewColumn.Two, options = {}) {
    const existing = this.panels.get(panelId);
    
    // �?已存在：直接显示，不刷新内容
    if ((existing && existing.panel)) {
      existing.panel.reveal(viewColumn);
      return existing.panel;
    }
    
    // 🔧 创建新面�?
    const panel = vscode.window.createWebviewPanel(
      panelId,
      title,
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,  // 🔑 关键：隐藏时保持状�?
        ...options
      }
    );
    
    // 🔑 简化：直接清理 Map，不需�?subscriptions
    panel.onDidDispose(() => {
      this.panels.delete(panelId);
    });
    
    // 缓存面板 + 额外数据
    this.panels.set(panelId, { panel, data: {} });
    
    return panel;
  }

  /**
   * 更新面板缓存数据
   */
  update(panelId, data) {
    const entry = this.panels.get(panelId);
    if (entry) {
      entry.data = { ...entry.data, ...data };
    }
  }

  /**
   * 获取面板缓存数据
   */
  getData(panelId) {
    return (this.panels.get(panelId) && this.panels.get(panelId).data) || {};
  }

  /**
   * 关闭指定面板
   */
  close(panelId) {
    const entry = this.panels.get(panelId);
    if ((entry && entry.panel)) {
      entry.panel.dispose();  // 会触�?onDidDispose 自动清理
    }
  }

  /**
   * 刷新面板内容（先清空再赋值，强制刷新�?
   */
  refresh(panelId, newHtml) {
    const entry = this.panels.get(panelId);
    if ((entry && entry.panel)) {
      entry.panel.webview.html = '';
      setTimeout(() => {
        entry.panel.webview.html = newHtml;
      }, 10);
    }
  }
}

// 🔑 导出单例实例
module.exports = new PanelManager();