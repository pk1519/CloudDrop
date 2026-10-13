// background.js - Service Worker for Chrome Extension

let accessToken = null;
let refreshToken = null;
let tokenExpiryTime = null;
let isCloudModeEnabled = false;
let selectedFolderId = null;
let selectedFolderName = 'Root';
let downloadHistory = [];
let fileTypeFilters = ['*']; // '*' means all files
let maxFileSize = 100; // MB
let autoSync = true;

// Initialize extension on startup
chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);

async function initialize() {
  // Load saved settings
  const result = await chrome.storage.local.get([
    'accessToken',
    'refreshToken',
    'tokenExpiryTime',
    'isCloudModeEnabled', 
    'selectedFolderId',
    'selectedFolderName',
    'downloadHistory',
    'fileTypeFilters',
    'maxFileSize',
    'autoSync'
  ]);
  
  accessToken = result.accessToken || null;
  refreshToken = result.refreshToken || null;
  tokenExpiryTime = result.tokenExpiryTime || null;
  isCloudModeEnabled = result.isCloudModeEnabled || false;
  selectedFolderId = result.selectedFolderId || null;
  selectedFolderName = result.selectedFolderName || 'Root';
  downloadHistory = result.downloadHistory || [];
  fileTypeFilters = result.fileTypeFilters || ['*'];
  maxFileSize = result.maxFileSize || 100;
  autoSync = result.autoSync !== undefined ? result.autoSync : true;
  
  console.log('Extension initialized:', { isCloudModeEnabled, selectedFolderName });
}

// Listen for download events
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (!isCloudModeEnabled || !accessToken) {
    console.log('Cloud mode disabled or not authenticated');
    return;
  }
  
  console.log('Download detected:', downloadItem);
  
  try {
    // Wait a moment for the download to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Cancel the local download
    await chrome.downloads.cancel(downloadItem.id);
    
    // Upload to Google Drive instead
    await uploadToGoogleDrive(downloadItem);
    
  } catch (error) {
    console.error('Error handling download:', error);
    showNotification('❌ Failed to save to Drive: ' + error.message, 'error');
  }
});

// Upload file to Google Drive
async function uploadToGoogleDrive(downloadItem) {
  try {
    showNotification('📤 Uploading to Google Drive...', 'progress');
    
    let fileBlob;
    let fileName = downloadItem.filename || getFileNameFromUrl(downloadItem.url);
    
    try {
      // Attempt to fetch the file data from the URL
      const response = await fetch(downloadItem.url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      fileBlob = await response.blob();
      
    } catch (fetchError) {
      console.error('Direct fetch failed:', fetchError);
      
      // Handle CORS and other fetch errors
      if (fetchError.message.includes('CORS') || fetchError.message.includes('Failed to fetch')) {
        // Try alternative approach using chrome.downloads API
        try {
          fileBlob = await downloadFileUsingChromeAPI(downloadItem);
        } catch (chromeError) {
          throw new Error(`Cannot access file due to CORS restrictions. The website "${new URL(downloadItem.url).hostname}" doesn't allow direct access from extensions. Please download the file manually and upload it to Google Drive.`);
        }
      } else {
        throw fetchError;
      }
    }
    
    // Validate file blob
    if (!fileBlob || fileBlob.size === 0) {
      throw new Error('Downloaded file is empty or invalid');
    }
    
    // Check file size limit
    if (fileBlob.size > maxFileSize * 1024 * 1024) {
      throw new Error(`File size (${Math.round(fileBlob.size / 1024 / 1024)}MB) exceeds limit (${maxFileSize}MB)`);
    }
    
    // Check file type filter
    if (!isFileTypeAllowed(fileName)) {
      throw new Error(`File type not allowed by current filter settings`);
    }
    
    // Upload to Google Drive
    const fileId = await uploadFileToGoogleDrive(fileBlob, fileName, selectedFolderId);
    
    // Add to download history
    await addToDownloadHistory(fileName, fileBlob.size, Date.now(), fileId);
    
    // Show success notification
    const folderPath = selectedFolderName === 'Root' ? '/' : `/${selectedFolderName}`;
    showNotification(`✅ File saved to Google Drive ${folderPath}/${fileName}`, 'success');
    
    console.log('File uploaded successfully:', fileId);
    
  } catch (error) {
    console.error('Upload failed:', error);
    showNotification('❌ Upload failed: ' + error.message, 'error');
  }
}

// Upload file to Google Drive API
async function uploadFileToGoogleDrive(fileBlob, fileName, folderId) {
  try {
    // First, check if we have a valid access token
    if (!accessToken) {
      throw new Error('No access token available');
    }

    const metadata = {
      name: fileName,
      parents: folderId ? [folderId] : undefined
    };
    
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', fileBlob, fileName);
    
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Upload failed';
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
        
        // Handle specific error cases
        if (response.status === 401) {
          // Token expired, clear it
          accessToken = null;
          await chrome.storage.local.remove(['accessToken']);
          errorMessage = 'Authentication expired. Please login again.';
        } else if (response.status === 403) {
          errorMessage = 'Access denied. Check your Google Drive permissions.';
        } else if (response.status === 404) {
          errorMessage = 'Target folder not found. Please select a valid folder.';
        }
      } catch (e) {
        console.error('Error parsing response:', errorText);
      }
      
      throw new Error(errorMessage);
    }
    
    const result = await response.json();
    console.log('Upload successful:', result);
    return result.id;
    
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
}

// Alternative download method using Chrome Downloads API
async function downloadFileUsingChromeAPI(downloadItem) {
  return new Promise((resolve, reject) => {
    // Create a temporary download to get the file data
    const tempDownloadId = downloadItem.id;
    
    // Listen for download completion
    const onChanged = (delta) => {
      if (delta.id === tempDownloadId && delta.state && delta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(onChanged);
        
        // Search for the completed download
        chrome.downloads.search({ id: tempDownloadId }, async (results) => {
          if (results && results.length > 0) {
            const download = results[0];
            if (download.filename) {
              try {
                // Read the downloaded file
                const response = await fetch(`file://${download.filename}`);
                const blob = await response.blob();
                resolve(blob);
              } catch (error) {
                reject(new Error('Failed to read downloaded file'));
              }
            } else {
              reject(new Error('Download completed but file not found'));
            }
          } else {
            reject(new Error('Download not found'));
          }
        });
      } else if (delta.id === tempDownloadId && delta.error) {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error(`Download failed: ${delta.error.current}`));
      }
    };
    
    chrome.downloads.onChanged.addListener(onChanged);
    
    // Resume the download if it was paused
    chrome.downloads.resume(tempDownloadId, () => {
      if (chrome.runtime.lastError) {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error('Failed to resume download: ' + chrome.runtime.lastError.message));
      }
    });
    
    // Set timeout to avoid hanging
    setTimeout(() => {
      chrome.downloads.onChanged.removeListener(onChanged);
      reject(new Error('Download timeout'));
    }, 30000); // 30 second timeout
  });
}

// Extract filename from URL
function getFileNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop() || 'downloaded_file';
    return decodeURIComponent(filename);
  } catch {
    return 'downloaded_file';
  }
}

// Show notification
function showNotification(message, type = 'info') {
  const iconUrl = type === 'error' ? 'icons/icon48.png' : 'icons/icon48.png';
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconUrl,
    title: 'Drive Download Manager',
    message: message
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'authenticate':
          const token = await authenticateWithGoogle();
          sendResponse({ success: true, token });
          break;
          
        case 'setCloudMode':
          isCloudModeEnabled = request.enabled;
          await chrome.storage.local.set({ isCloudModeEnabled });
          sendResponse({ success: true });
          break;
          
        case 'setSelectedFolder':
          selectedFolderId = request.folderId;
          selectedFolderName = request.folderName;
          await chrome.storage.local.set({ selectedFolderId, selectedFolderName });
          sendResponse({ success: true });
          break;
          
        case 'getSettings':
          sendResponse({
            success: true,
            settings: {
              isAuthenticated: !!accessToken,
              isCloudModeEnabled,
              selectedFolderId,
              selectedFolderName
            }
          });
          break;
          
        case 'getFolders':
          const folders = await getGoogleDriveFolders();
          sendResponse({ success: true, folders });
          break;
          
        case 'createFolder':
          const newFolder = await createGoogleDriveFolder(request.name, request.parentId);
          sendResponse({ success: true, folder: newFolder });
          break;
          
        case 'deleteFolder':
          await deleteGoogleDriveFolder(request.folderId);
          sendResponse({ success: true });
          break;
          
        case 'getStorageQuota':
          const quota = await getGoogleDriveQuota();
          sendResponse({ success: true, quota });
          break;
          
        case 'logout':
          await logoutUser();
          sendResponse({ success: true });
          break;
          
        case 'getDownloadHistory':
          sendResponse({ success: true, history: downloadHistory });
          break;
          
        case 'clearDownloadHistory':
          downloadHistory = [];
          await chrome.storage.local.set({ downloadHistory });
          sendResponse({ success: true });
          break;
          
        case 'updateSettings':
          await updateUserSettings(request.settings);
          sendResponse({ success: true });
          break;
          
        case 'getFileTypeFilters':
          sendResponse({ success: true, filters: fileTypeFilters });
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep message channel open for async response
});

// Google OAuth Authentication
async function authenticateWithGoogle() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError) {
        console.error('Auth error:', chrome.runtime.lastError.message);
        
        // Handle specific error cases
        if (chrome.runtime.lastError.message.includes('user did not approve')) {
          reject(new Error('Please approve access to Google Drive in the popup window'));
        } else if (chrome.runtime.lastError.message.includes('OAuth2 not granted')) {
          reject(new Error('OAuth2 access denied. Please check your Google Cloud Console settings'));
        } else {
          reject(new Error(chrome.runtime.lastError.message));
        }
        return;
      }
      
      if (token) {
        accessToken = token;
        tokenExpiryTime = Date.now() + (3600 * 1000); // 1 hour from now
        await chrome.storage.local.set({ 
          accessToken: token,
          tokenExpiryTime: tokenExpiryTime
        });
        console.log('Authentication successful');
        resolve(token);
      } else {
        reject(new Error('Failed to get auth token - no token returned'));
      }
    });
  });
}

// Logout user and clear all tokens
async function logoutUser() {
  try {
    // Revoke the token if it exists
    if (accessToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
        method: 'POST'
      });
    }
    
    // Clear Chrome identity cache
    chrome.identity.clearAllCachedAuthTokens();
    
    // Clear all stored data
    accessToken = null;
    refreshToken = null;
    tokenExpiryTime = null;
    
    await chrome.storage.local.remove([
      'accessToken', 
      'refreshToken', 
      'tokenExpiryTime'
    ]);
    
    console.log('User logged out successfully');
  } catch (error) {
    console.error('Logout error:', error);
    // Still clear local data even if revoke fails
    accessToken = null;
    refreshToken = null;
    tokenExpiryTime = null;
    
    await chrome.storage.local.remove([
      'accessToken', 
      'refreshToken', 
      'tokenExpiryTime'
    ]);
  }
}

// Update user settings
async function updateUserSettings(settings) {
  if (settings.fileTypeFilters !== undefined) {
    fileTypeFilters = settings.fileTypeFilters;
    await chrome.storage.local.set({ fileTypeFilters });
  }
  
  if (settings.maxFileSize !== undefined) {
    maxFileSize = settings.maxFileSize;
    await chrome.storage.local.set({ maxFileSize });
  }
  
  if (settings.autoSync !== undefined) {
    autoSync = settings.autoSync;
    await chrome.storage.local.set({ autoSync });
  }
}

// Add download to history
async function addToDownloadHistory(fileName, fileSize, uploadTime, driveFileId) {
  const historyItem = {
    id: Date.now().toString(),
    fileName,
    fileSize,
    uploadTime,
    driveFileId,
    folderName: selectedFolderName
  };
  
  downloadHistory.unshift(historyItem);
  
  // Keep only last 100 downloads
  if (downloadHistory.length > 100) {
    downloadHistory = downloadHistory.slice(0, 100);
  }
  
  await chrome.storage.local.set({ downloadHistory });
}

// Check if file type is allowed by current filters
function isFileTypeAllowed(fileName) {
  if (fileTypeFilters.includes('*')) {
    return true;
  }
  
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (!extension) {
    return false;
  }
  
  return fileTypeFilters.includes(extension);
}

// Get Google Drive folders
async function getGoogleDriveFolders() {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.folder'&fields=files(id,name,parents)",
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch folders');
  }
  
  const data = await response.json();
  return data.files || [];
}

// Create Google Drive folder
async function createGoogleDriveFolder(name, parentId = null) {
  const metadata = {
    name: name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined
  };
  
  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });
  
  if (!response.ok) {
    throw new Error('Failed to create folder');
  }
  
  return await response.json();
}

// Delete Google Drive folder
async function deleteGoogleDriveFolder(folderId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to delete folder');
  }
}

// Get Google Drive storage quota
async function getGoogleDriveQuota() {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch storage quota');
  }
  
  const data = await response.json();
  return data.storageQuota;
}