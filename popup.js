// popup.js - Chrome Extension Popup Interface

class DriveDownloadManager {
    constructor() {
        this.isAuthenticated = false;
        this.isCloudModeEnabled = false;
        this.selectedFolderId = null;
        this.selectedFolderName = 'Root';
        this.folders = [];
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadSettings();
    }

    initializeElements() {
        // Main elements
        this.authStatus = document.getElementById('auth-status');
        this.authIndicator = document.getElementById('auth-indicator');
        this.authText = document.getElementById('auth-text');
        this.authBtn = document.getElementById('auth-btn');
        this.logoutBtn = document.getElementById('logout-btn');
        this.mainContent = document.getElementById('main-content');
        this.loading = document.getElementById('loading');
        
        // Controls
        this.cloudModeToggle = document.getElementById('cloud-mode-toggle');
        this.selectedFolderName = document.getElementById('selected-folder-name');
        this.browseFoldersBtn = document.getElementById('browse-folders-btn');
        this.createFolderBtn = document.getElementById('create-folder-btn');
        
        // Quota elements
        this.quotaFill = document.getElementById('quota-fill');
        this.quotaUsed = document.getElementById('quota-used');
        this.quotaTotal = document.getElementById('quota-total');
        
        // Modal elements
        this.folderModal = document.getElementById('folder-modal');
        this.closeModal = document.getElementById('close-modal');
        this.folderList = document.getElementById('folder-list');
        
        this.createFolderModal = document.getElementById('create-folder-modal');
        this.closeCreateModal = document.getElementById('close-create-modal');
        this.folderNameInput = document.getElementById('folder-name-input');
        this.cancelCreateFolder = document.getElementById('cancel-create-folder');
        this.confirmCreateFolder = document.getElementById('confirm-create-folder');
        
        // History elements
        this.historyList = document.getElementById('history-list');
        this.clearHistoryBtn = document.getElementById('clear-history-btn');
        
        // Settings elements
        this.fileTypeFilter = document.getElementById('file-type-filter');
        this.maxFileSize = document.getElementById('max-file-size');
    }

    attachEventListeners() {
        // Authentication
        this.authBtn.addEventListener('click', () => this.authenticate());
        this.logoutBtn.addEventListener('click', () => this.logout());
        
        // Cloud mode toggle
        this.cloudModeToggle.addEventListener('change', (e) => {
            this.setCloudMode(e.target.checked);
        });
        
        // Folder management
        this.browseFoldersBtn.addEventListener('click', () => this.showFolderBrowser());
        this.createFolderBtn.addEventListener('click', () => this.showCreateFolderModal());
        
        // Modal controls
        this.closeModal.addEventListener('click', () => this.hideFolderBrowser());
        this.closeCreateModal.addEventListener('click', () => this.hideCreateFolderModal());
        this.cancelCreateFolder.addEventListener('click', () => this.hideCreateFolderModal());
        this.confirmCreateFolder.addEventListener('click', () => this.createFolder());
        
        // Close modals on backdrop click
        this.folderModal.addEventListener('click', (e) => {
            if (e.target === this.folderModal) {
                this.hideFolderBrowser();
            }
        });
        
        this.createFolderModal.addEventListener('click', (e) => {
            if (e.target === this.createFolderModal) {
                this.hideCreateFolderModal();
            }
        });
        
        // Enter key for folder creation
        this.folderNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.createFolder();
            }
        });
        
        // History management
        this.clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        
        // Settings
        this.fileTypeFilter.addEventListener('change', () => this.updateSettings());
        this.maxFileSize.addEventListener('change', () => this.updateSettings());
    }

    async loadSettings() {
        this.showLoading();
        
        try {
            const response = await this.sendMessage({ action: 'getSettings' });
            if (response.success) {
                const { isAuthenticated, isCloudModeEnabled, selectedFolderId, selectedFolderName } = response.settings;
                
                this.isAuthenticated = isAuthenticated;
                this.isCloudModeEnabled = isCloudModeEnabled;
                this.selectedFolderId = selectedFolderId;
                this.selectedFolderName = selectedFolderName || 'Root';
                
                this.updateUI();
                
                if (this.isAuthenticated) {
                    await this.loadStorageQuota();
                    await this.loadDownloadHistory();
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.showError('Failed to load settings');
        }
        
        this.hideLoading();
    }

    updateUI() {
        // Update authentication status
        if (this.isAuthenticated) {
            this.authIndicator.classList.add('authenticated');
            this.authText.textContent = 'Authenticated with Google Drive';
            this.authBtn.style.display = 'none';
            this.logoutBtn.style.display = 'block';
            this.mainContent.style.display = 'block';
        } else {
            this.authIndicator.classList.remove('authenticated');
            this.authText.textContent = 'Not authenticated';
            this.authBtn.style.display = 'block';
            this.logoutBtn.style.display = 'none';
            this.mainContent.style.display = 'none';
        }
        
        // Update cloud mode toggle
        this.cloudModeToggle.checked = this.isCloudModeEnabled;
        
        // Update selected folder name
        document.getElementById('selected-folder-name').textContent = this.selectedFolderName;
    }

    async authenticate() {
        this.showLoading();
        
        try {
            const response = await this.sendMessage({ action: 'authenticate' });
            if (response.success) {
                this.isAuthenticated = true;
                this.updateUI();
                await this.loadStorageQuota();
                this.showSuccess('Successfully authenticated with Google Drive!');
            } else {
                throw new Error(response.error || 'Authentication failed');
            }
        } catch (error) {
            console.error('Authentication error:', error);
            
            // Show user-friendly error messages
            let errorMessage = 'Authentication failed: ';
            if (error.message.includes('user did not approve')) {
                errorMessage = 'Please click "Allow" in the Google authorization popup to continue.';
            } else if (error.message.includes('OAuth2')) {
                errorMessage = 'OAuth2 setup issue. Please check the setup instructions.';
            } else {
                errorMessage += error.message;
            }
            
            this.showError(errorMessage);
        }
        
        this.hideLoading();
    }

    async logout() {
        this.showLoading();
        
        try {
            const response = await this.sendMessage({ action: 'logout' });
            if (response.success) {
                this.isAuthenticated = false;
                this.updateUI();
                this.showSuccess('Successfully logged out');
            } else {
                throw new Error(response.error || 'Logout failed');
            }
        } catch (error) {
            console.error('Logout error:', error);
            this.showError('Logout failed: ' + error.message);
        }
        
        this.hideLoading();
    }

    async loadDownloadHistory() {
        try {
            const response = await this.sendMessage({ action: 'getDownloadHistory' });
            if (response.success) {
                this.renderDownloadHistory(response.history);
            }
        } catch (error) {
            console.error('Failed to load download history:', error);
        }
    }

    renderDownloadHistory(history) {
        if (!history || history.length === 0) {
            this.historyList.innerHTML = '<div class="history-empty">No downloads yet</div>';
            return;
        }

        this.historyList.innerHTML = history.slice(0, 5).map(item => `
            <div class="history-item">
                <div>
                    <div style="font-weight: 500;">${item.fileName}</div>
                    <div style="color: #666; font-size: 10px;">${new Date(item.uploadTime).toLocaleString()}</div>
                </div>
                <div style="color: #666; font-size: 10px;">${this.formatFileSize(item.fileSize)}</div>
            </div>
        `).join('');
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async clearHistory() {
        try {
            const response = await this.sendMessage({ action: 'clearDownloadHistory' });
            if (response.success) {
                this.renderDownloadHistory([]);
                this.showSuccess('Download history cleared');
            }
        } catch (error) {
            console.error('Failed to clear history:', error);
            this.showError('Failed to clear history');
        }
    }

    async updateSettings() {
        try {
            const settings = {
                fileTypeFilters: this.getFileTypeFilters(),
                maxFileSize: parseInt(this.maxFileSize.value) || 100
            };

            const response = await this.sendMessage({
                action: 'updateSettings',
                settings: settings
            });

            if (response.success) {
                this.showSuccess('Settings updated');
            }
        } catch (error) {
            console.error('Failed to update settings:', error);
            this.showError('Failed to update settings');
        }
    }

    getFileTypeFilters() {
        const value = this.fileTypeFilter.value;
        switch (value) {
            case 'images':
                return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
            case 'documents':
                return ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'];
            case 'videos':
                return ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'];
            case '*':
            default:
                return ['*'];
        }
    }

    async setCloudMode(enabled) {
        try {
            const response = await this.sendMessage({
                action: 'setCloudMode',
                enabled: enabled
            });
            
            if (response.success) {
                this.isCloudModeEnabled = enabled;
                const message = enabled 
                    ? 'Cloud mode enabled - downloads will be saved to Google Drive'
                    : 'Cloud mode disabled - downloads will be saved locally';
                this.showSuccess(message);
            } else {
                throw new Error(response.error || 'Failed to update cloud mode');
            }
        } catch (error) {
            console.error('Failed to set cloud mode:', error);
            this.cloudModeToggle.checked = this.isCloudModeEnabled; // Revert toggle
            this.showError('Failed to update cloud mode');
        }
    }

    async showFolderBrowser() {
        try {
            this.showLoading();
            
            const response = await this.sendMessage({ action: 'getFolders' });
            if (response.success) {
                this.folders = response.folders;
                this.renderFolderList();
                this.folderModal.style.display = 'flex';
            } else {
                throw new Error(response.error || 'Failed to load folders');
            }
        } catch (error) {
            console.error('Failed to load folders:', error);
            this.showError('Failed to load folders');
        }
        
        this.hideLoading();
    }

    hideFolderBrowser() {
        this.folderModal.style.display = 'none';
    }

    renderFolderList() {
        this.folderList.innerHTML = '';
        
        // Add root folder option
        const rootItem = this.createFolderItem('Root', null, 'Root');
        this.folderList.appendChild(rootItem);
        
        // Add other folders
        this.folders.forEach(folder => {
            const folderItem = this.createFolderItem(folder.name, folder.id, folder.name);
            this.folderList.appendChild(folderItem);
        });
    }

    createFolderItem(name, id, displayName) {
        const item = document.createElement('div');
        item.className = 'folder-item';
        if (id === this.selectedFolderId || (id === null && this.selectedFolderId === null)) {
            item.classList.add('selected');
        }
        
        item.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z"/>
            </svg>
            <span>${displayName}</span>
        `;
        
        item.addEventListener('click', () => this.selectFolder(id, name));
        
        return item;
    }

    async selectFolder(folderId, folderName) {
        try {
            const response = await this.sendMessage({
                action: 'setSelectedFolder',
                folderId: folderId,
                folderName: folderName
            });
            
            if (response.success) {
                this.selectedFolderId = folderId;
                this.selectedFolderName = folderName;
                this.updateUI();
                this.hideFolderBrowser();
                this.showSuccess(`Selected folder: ${folderName}`);
            } else {
                throw new Error(response.error || 'Failed to select folder');
            }
        } catch (error) {
            console.error('Failed to select folder:', error);
            this.showError('Failed to select folder');
        }
    }

    showCreateFolderModal() {
        this.folderNameInput.value = '';
        this.createFolderModal.style.display = 'flex';
        this.folderNameInput.focus();
    }

    hideCreateFolderModal() {
        this.createFolderModal.style.display = 'none';
    }

    async createFolder() {
        const folderName = this.folderNameInput.value.trim();
        
        if (!folderName) {
            this.showError('Please enter a folder name');
            return;
        }
        
        try {
            this.showLoading();
            
            const response = await this.sendMessage({
                action: 'createFolder',
                name: folderName,
                parentId: this.selectedFolderId
            });
            
            if (response.success) {
                this.hideCreateFolderModal();
                this.showSuccess(`Folder "${folderName}" created successfully!`);
                
                // Refresh folder list if browser is open
                if (this.folderModal.style.display === 'flex') {
                    await this.showFolderBrowser();
                }
            } else {
                throw new Error(response.error || 'Failed to create folder');
            }
        } catch (error) {
            console.error('Failed to create folder:', error);
            this.showError('Failed to create folder: ' + error.message);
        }
        
        this.hideLoading();
    }

    async loadStorageQuota() {
        try {
            const response = await this.sendMessage({ action: 'getStorageQuota' });
            if (response.success) {
                this.updateStorageQuota(response.quota);
            }
        } catch (error) {
            console.error('Failed to load storage quota:', error);
        }
    }

    updateStorageQuota(quota) {
        const used = parseInt(quota.usage) || 0;
        const total = parseInt(quota.limit) || 15000000000; // Default 15GB
        
        const usedGB = (used / 1000000000).toFixed(1);
        const totalGB = (total / 1000000000).toFixed(0);
        const percentage = Math.min((used / total) * 100, 100);
        
        this.quotaUsed.textContent = `${usedGB} GB`;
        this.quotaTotal.textContent = `/ ${totalGB} GB`;
        this.quotaFill.style.width = `${percentage}%`;
        
        // Update quota bar color based on usage
        if (percentage > 90) {
            this.quotaFill.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
        } else if (percentage > 75) {
            this.quotaFill.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
        } else {
            this.quotaFill.style.background = 'linear-gradient(90deg, #4ade80, #22c55e)';
        }
    }

    async sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    showLoading() {
        this.loading.style.display = 'flex';
    }

    hideLoading() {
        this.loading.style.display = 'none';
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 16px',
            borderRadius: '8px',
            color: 'white',
            fontWeight: '500',
            fontSize: '12px',
            zIndex: '10000',
            maxWidth: '280px',
            wordWrap: 'break-word',
            transform: 'translateX(100%)',
            transition: 'transform 0.3s ease',
            background: type === 'error' ? '#ef4444' : '#22c55e'
        });
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Initialize the popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new DriveDownloadManager();
});