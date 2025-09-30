// Check authentication
function checkAuth() {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (!user.isLoggedIn) {
        window.location.href = 'login.html';
    }
    return user;
}

// DOM Elements
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in
    const user = checkAuth();
    
    // Update header with user info
    const userBtn = document.querySelector('.user-btn');
    const displayName = user.email ? user.email.split('@')[0] : 'User';
    userBtn.innerHTML = `<i class="fas fa-user-circle"></i> ${displayName}`;
    
    // Add logout functionality
    userBtn.addEventListener('click', function() {
        if (confirm('Are you sure you want to logout?')) {
            sessionStorage.removeItem('user');
            window.location.href = 'login.html';
        }
    });
    
    // Initialize portal status
    initPortalStatus();
    
    // Navigation
    const navLinks = document.querySelectorAll('.main-nav a');
    const sections = document.querySelectorAll('.section');

    // Tables
    const assetTableBody = document.querySelector('#asset-registry .data-table tbody');
    const inventoryTableBody = document.querySelector('#inventory-status .data-table tbody');

    // QR Code
    const generateQrBtn = document.getElementById('generate-qr');
    const qrCodeContainer = document.getElementById('qr-container');
    const downloadQrBtn = document.getElementById('download-qr');


    // Scanner
    const startScannerBtn = document.getElementById('start-scanner');
    const stopScannerBtn = document.getElementById('stop-scanner');
    const scanResultData = document.getElementById('scan-result-data');
    let html5QrCode;

    // AI Report
    const generateReportBtn = document.getElementById('generate-report');
    const reportContainer = document.getElementById('report-container');

    // Navigation functionality
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href').substring(1);
            
            // Update active nav link
            navLinks.forEach(link => {
                link.parentElement.classList.remove('active');
            });
            this.parentElement.classList.add('active');
            
            // Show target section
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === targetId) {
                    section.classList.add('active');
                }
            });
        });
    });

    // Sample data for assets
    const assetData = [
        { id: 'AST-001', type: 'Rail', location: 'Section A-12', status: 'Active' },
        { id: 'AST-002', type: 'Sleeper', location: 'Section B-05', status: 'Maintenance' },
        { id: 'AST-003', type: 'Fastening', location: 'Section A-08', status: 'Active' },
        { id: 'AST-004', type: 'Ballast', location: 'Section C-03', status: 'Inactive' },
        { id: 'AST-005', type: 'Rail', location: 'Section D-11', status: 'Active' }
    ];

    // Sample data for inventory
    const inventoryData = [
        { id: 'INV-001', type: 'Rail', batch: 'B-2023-01', vendor: 'Steel Corp', warranty: '24 months', createdAt: '2023-01-15' },
        { id: 'INV-002', type: 'Sleeper', batch: 'B-2023-02', vendor: 'Concrete Solutions', warranty: '36 months', createdAt: '2023-02-20' },
        { id: 'INV-003', type: 'Fastening', batch: 'B-2023-01', vendor: 'Metal Works', warranty: '12 months', createdAt: '2023-01-30' },
        { id: 'INV-004', type: 'Ballast', batch: 'B-2023-03', vendor: 'Stone Quarry Ltd', warranty: 'N/A', createdAt: '2023-03-10' },
        { id: 'INV-005', type: 'Rail', batch: 'B-2023-04', vendor: 'Steel Corp', warranty: '24 months', createdAt: '2023-04-05' }
    ];

    // Populate asset table
    function populateAssetTable() {
        assetTableBody.innerHTML = '';
        assetData.forEach(asset => {
            const statusClass = asset.status === 'Active' ? 'success' : 
                              asset.status === 'Maintenance' ? 'warning' : 'danger';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${asset.id}</td>
                <td>${asset.type}</td>
                <td>${asset.location}</td>
                <td><span class="status-badge ${statusClass}">${asset.status}</span></td>
                <td>
                    <button class="btn-icon" title="View"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            `;
            assetTableBody.appendChild(row);
        });
    }

    // Populate inventory table
    function populateInventoryTable() {
        inventoryTableBody.innerHTML = '';
        inventoryData.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.id}</td>
                <td>${item.type}</td>
                <td>${item.batch}</td>
                <td>${item.vendor}</td>
                <td>${item.warranty}</td>
                <td>${item.createdAt}</td>
                <td>
                    <button class="btn-icon" title="View"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            `;
            inventoryTableBody.appendChild(row);
        });
    }

    // Initialize charts
    function initCharts() {
        // Inventory Status Chart
        const inventoryCtx = document.getElementById('inventoryChart').getContext('2d');
        new Chart(inventoryCtx, {
            type: 'doughnut',
            data: {
                labels: ['In Stock', 'Deployed', 'Maintenance', 'Disposed'],
                datasets: [{
                    data: [65, 20, 10, 5],
                    backgroundColor: [
                        '#34a853',
                        '#1a73e8',
                        '#fbbc04',
                        '#ea4335'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right'
                    }
                }
            }
        });

        // Inspection Status Chart
        const inspectionCtx = document.getElementById('inspectionChart').getContext('2d');
        new Chart(inspectionCtx, {
            type: 'doughnut',
            data: {
                labels: ['Passed', 'Failed', 'Pending'],
                datasets: [{
                    data: [75, 15, 10],
                    backgroundColor: [
                        '#34a853',
                        '#ea4335',
                        '#fbbc04'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right'
                    }
                }
            }
        });

        // Vendor Performance Chart
        const vendorCtx = document.getElementById('vendorChart').getContext('2d');
        new Chart(vendorCtx, {
            type: 'bar',
            data: {
                labels: ['Steel Corp', 'Concrete Solutions', 'Metal Works', 'Stone Quarry Ltd'],
                datasets: [{
                    label: 'Quality Score',
                    data: [85, 92, 78, 88],
                    backgroundColor: '#1a73e8',
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });
    }



    // QR Generator Elements
    const vendorNameInput = document.getElementById('vendor-name');
    const batchNumberInput = document.getElementById('batch-number');
    const supplyDateInput = document.getElementById('supply-date');
    const warrantyPeriodInput = document.getElementById('warranty-period');
    const currentStatusSelect = document.getElementById('current-status');
    // Set default date to today if the element exists
    if (supplyDateInput) {
        supplyDateInput.valueAsDate = new Date();
    }
    
    // QR Code Generation
    if (generateQrBtn) {
        generateQrBtn.addEventListener('click', function() {
            generateQR();
        });
    }
    
    // Function to generate QR code
    function generateQR() {
        try {
            // Get form elements directly
            const vendorNameInput = document.getElementById('vendor-name');
            const batchNumberInput = document.getElementById('batch-number');
            const supplyDateInput = document.getElementById('supply-date');
            const warrantyPeriodInput = document.getElementById('warranty-period');
            const currentStatusSelect = document.getElementById('current-status');
            
            // Get values from form with defaults
            const vendorName = vendorNameInput && vendorNameInput.value ? vendorNameInput.value : 'Unknown Vendor';
            const batchNumber = batchNumberInput && batchNumberInput.value ? batchNumberInput.value : 'BATCH-' + Math.floor(1000 + Math.random() * 9000);
            const supplyDate = supplyDateInput && supplyDateInput.value ? supplyDateInput.value : new Date().toISOString().split('T')[0];
            const warrantyPeriod = warrantyPeriodInput && warrantyPeriodInput.value ? warrantyPeriodInput.value : '12';
            const currentStatus = currentStatusSelect && currentStatusSelect.value ? currentStatusSelect.value : 'active';
            
            // Create QR data object with well-structured data
            const qrData = {
                type: 'railway-component',
                id: 'RW-' + Math.floor(10000 + Math.random() * 90000),
                vendorName: vendorName,
                batchNumber: batchNumber,
                supplyDate: supplyDate,
                warrantyPeriod: warrantyPeriod + ' months',
                currentStatus: currentStatus,
                generatedAt: new Date().toISOString()
            };
            
            // Convert to JSON string - compact format for better QR code density
            const qrDataString = JSON.stringify(qrData);
            
            // Clear previous content
            if (qrCodeContainer) {
                qrCodeContainer.innerHTML = '';
            } else {
                console.error('QR code container not found');
                return;
            }
            
            // Generate QR code with higher version to accommodate more data
            try {
                // Increase QR code version from 4 to 10 to handle more data
                // Use 'M' error correction instead of 'H' to allow more data capacity
                const qr = qrcode(10, 'M'); 
                qr.addData(qrDataString);
                qr.make();
                
                // Create QR code with larger size for better readability
                const qrImg = qr.createImgTag(5, 8); // Adjusted cell size and margin
                qrCodeContainer.innerHTML = qrImg;
                
                // Add QR data below the image for reference
                const dataDisplay = document.createElement('pre');
                dataDisplay.className = 'qr-data-display';
                dataDisplay.textContent = JSON.stringify(qrData, null, 2);
                qrCodeContainer.appendChild(dataDisplay);
                
                // Enable download button
                if (downloadQrBtn) {
                    downloadQrBtn.disabled = false;
                    
                    // Add download functionality
                    downloadQrBtn.onclick = function() {
                        const img = qrCodeContainer.querySelector('img');
                        if (img) {
                            const link = document.createElement('a');
                            link.download = 'railway-qr-' + qrData.id + '.png';
                            link.href = img.src;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                        }
                    };
                }
                
                // Show success message
                const successMsg = document.createElement('div');
                successMsg.className = 'alert alert-success mt-3';
                successMsg.innerHTML = 'QR Code generated successfully! You can now download or scan it.';
                qrCodeContainer.appendChild(successMsg);
            } catch (qrError) {
                console.error('Error generating QR code:', qrError);
                qrCodeContainer.innerHTML = '<div class="alert alert-danger">Failed to generate QR code. Please try again.</div>';
            }
        } catch (error) {
            console.error('Error in QR generation:', error);
            if (qrCodeContainer) {
                qrCodeContainer.innerHTML = '<div class="alert alert-danger">An error occurred. Please try again.</div>';
            }
        }
    }

    // Download QR Code
    downloadQrBtn.addEventListener('click', function() {
        const img = qrCodeContainer.querySelector('img');
        if (img) {
            const vendorName = vendorNameInput.value || 'unknown';
            const batchNumber = batchNumberInput.value || 'batch';
            const fileName = `qr-${vendorName}-${batchNumber}`.replace(/\s+/g, '-').toLowerCase();
            
            const link = document.createElement('a');
            link.download = `${fileName}.png`;
            link.href = img.src;
            link.click();
        }
    });

    // QR Scanner functionality using HTML5-QRCode
    startScannerBtn.addEventListener('click', function() {
        startScannerBtn.disabled = true;
        stopScannerBtn.disabled = false;
        
        // Initialize HTML5 QR code scanner
        html5QrCode = new Html5Qrcode("qr-reader");
        const qrConfig = { fps: 10, qrbox: { width: 250, height: 250 } };
        
        // Start scanning
        html5QrCode.start(
            { facingMode: "environment" }, // Use back camera
            qrConfig,
            onScanSuccess,
            onScanFailure
        ).catch(err => {
            console.error("QR Scanner error:", err);
            scanResultData.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #ea4335;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem;"></i>
                    <p>Camera access denied or not available</p>
                    <p>Error: ${err.message}</p>
                </div>
            `;
            startScannerBtn.disabled = false;
            stopScannerBtn.disabled = true;
        });
    });
    
    // QR Code scan success handler
    function onScanSuccess(decodedText, decodedResult) {
        // Play a beep sound to indicate successful scan
        const beep = new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU");
        beep.play().catch(e => console.log("Audio play error:", e));
        
        // Process the QR code data
        try {
            // Try to parse as JSON
            const qrData = JSON.parse(decodedText);
            
            // Display structured data
            scanResultData.innerHTML = `
                <div class="scan-success">
                    <h4>Asset Found</h4>
                    ${qrData.assetId ? `<p><strong>Asset ID:</strong> ${qrData.assetId}</p>` : ''}
                    ${qrData.assetType ? `<p><strong>Type:</strong> ${qrData.assetType}</p>` : ''}
                    ${qrData.location ? `<p><strong>Location:</strong> ${qrData.location}</p>` : ''}
                    ${qrData.manufacturer ? `<p><strong>Manufacturer:</strong> ${qrData.manufacturer}</p>` : ''}
                    ${qrData.installationDate ? `<p><strong>Installation Date:</strong> ${qrData.installationDate}</p>` : ''}
                    ${qrData.status ? `<p><strong>Status:</strong> ${qrData.status}</p>` : ''}
                    ${qrData.condition ? `<p><strong>Condition:</strong> ${qrData.condition}</p>` : ''}
                </div>
            `;
        } catch (e) {
            // If not JSON, display as plain text
            scanResultData.innerHTML = `
                <div class="scan-success">
                    <h4>QR Code Scanned</h4>
                    <p><strong>Content:</strong> ${decodedText}</p>
                </div>
            `;
        }
        
        // Stop scanning after successful scan
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                console.log("QR Code scanning stopped");
                startScannerBtn.disabled = false;
                stopScannerBtn.disabled = true;
            }).catch(err => {
                console.error("Error stopping QR Code scanner:", err);
            });
        }
    }
    
    // QR Code scan failure handler
    function onScanFailure(error) {
        // Don't log scan failures as they happen continuously until a QR code is found
        // console.warn(`QR Code scanning failed: ${error}`);
    }

    // Stop QR scanner
    stopScannerBtn.addEventListener('click', function() {
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                console.log("QR Code scanning stopped");
                startScannerBtn.disabled = false;
                stopScannerBtn.disabled = true;
            }).catch(err => {
                console.error("Error stopping QR Code scanner:", err);
            });
        }
    });

    // Portal Status Initialization
function initPortalStatus() {
    console.log("Initializing portal status...");
    
    // Simulate checking connection status
    const udmPortalStatus = true; // Connected
    const tmsPortalStatus = true; // Connected
    
    // Update UI based on connection status
    updatePortalStatus('UDM', udmPortalStatus);
    updatePortalStatus('TMS', tmsPortalStatus);
    
    // Add click event listeners to portal detail buttons
    const portalButtons = document.querySelectorAll('.portal-details .btn');
    portalButtons.forEach(button => {
        button.addEventListener('click', function() {
            const portalType = this.closest('.portal-card').querySelector('h3').textContent;
            
            // Create detailed information for each portal type
            let detailsHTML = '';
            if (portalType.includes('UDM')) {
                detailsHTML = `
                    <div class="portal-details-modal">
                        <h3>UDM Portal Integration Details</h3>
                        <div class="details-grid">
                            <div class="detail-item">
                                <span class="detail-label">Status:</span>
                                <span class="detail-value success">Connected</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Last Sync:</span>
                                <span class="detail-value">Today, 10:45 AM</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">API Version:</span>
                                <span class="detail-value">v2.3.1</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Data Points:</span>
                                <span class="detail-value">1,245</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Last Error:</span>
                                <span class="detail-value success">None</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Uptime:</span>
                                <span class="detail-value">99.8%</span>
                            </div>
                        </div>
                        <div class="details-actions">
                            <button class="btn btn-secondary">Refresh Connection</button>
                            <button class="btn btn-primary">Force Sync</button>
                        </div>
                    </div>
                `;
            } else if (portalType.includes('TMS')) {
                detailsHTML = `
                    <div class="portal-details-modal">
                        <h3>TMS Portal Integration Details</h3>
                        <div class="details-grid">
                            <div class="detail-item">
                                <span class="detail-label">Status:</span>
                                <span class="detail-value success">Connected</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Last Sync:</span>
                                <span class="detail-value">Today, 10:30 AM</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">API Version:</span>
                                <span class="detail-value">v1.8.5</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Data Points:</span>
                                <span class="detail-value">2,873</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Last Error:</span>
                                <span class="detail-value warning">Timeout (3 days ago)</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Uptime:</span>
                                <span class="detail-value">98.2%</span>
                            </div>
                        </div>
                        <div class="details-actions">
                            <button class="btn btn-secondary">Refresh Connection</button>
                            <button class="btn btn-primary">Force Sync</button>
                        </div>
                    </div>
                `;
            }
            
            // Create modal element
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <span class="close-modal">&times;</span>
                    ${detailsHTML}
                </div>
            `;
            
            // Add modal to body
            document.body.appendChild(modal);
            
            // Show modal
            setTimeout(() => {
                modal.style.display = 'flex';
            }, 10);
            
            // Close modal when clicking on X
            modal.querySelector('.close-modal').addEventListener('click', function() {
                modal.style.display = 'none';
                setTimeout(() => {
                    modal.remove();
                }, 300);
            });
            
            // Close modal when clicking outside
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    modal.style.display = 'none';
                    setTimeout(() => {
                        modal.remove();
                    }, 300);
                }
            });
        });
    });
}

// Update Portal Status UI
function updatePortalStatus(portalType, isConnected) {
    const portalCards = document.querySelectorAll('.portal-card');
    
    portalCards.forEach(card => {
        const cardTitle = card.querySelector('h3').textContent;
        if (cardTitle.includes(portalType)) {
            const statusIcon = card.querySelector('.portal-status i');
            const statusText = card.querySelector('.portal-status p');
            
            if (isConnected) {
                statusIcon.className = 'fas fa-check-circle portal-connected';
                statusText.textContent = `${portalType} Portal is connected and integrated`;
            } else {
                statusIcon.className = 'fas fa-times-circle';
                statusIcon.style.color = '#dc3545';
                statusText.textContent = `${portalType} Portal connection failed`;
            }
        }
    });
}

// AI Report Generation
generateReportBtn.addEventListener('click', function() {
    const reportType = document.getElementById('report-type').value;
    const timePeriod = document.getElementById('time-period').value;
    
    if (!reportType || !timePeriod) {
        alert('Please select both report type and time period');
        return;
    }
    
    reportContainer.innerHTML = '<p>Generating report...</p>';
    
    // Simulate report generation
    setTimeout(() => {
        if (reportType === 'maintenance') {
            reportContainer.innerHTML = `
                <h3>Maintenance Prediction Report</h3>
                <p>Based on AI analysis of historical data for the ${timePeriod === '1month' ? 'last month' : 
                   timePeriod === '3months' ? 'last 3 months' : 
                   timePeriod === '6months' ? 'last 6 months' : 'last year'}, 
                   the following assets require maintenance:</p>
                <ul>
                    <li>AST-002 (Sleeper) - Predicted failure within 30 days (87% confidence)</li>
                    <li>AST-005 (Rail) - Recommended inspection within 45 days (72% confidence)</li>
                    <li>AST-008 (Fastening) - Showing early wear patterns (65% confidence)</li>
                </ul>
                <div class="chart-container">
                    <canvas id="maintenanceChart"></canvas>
                </div>
            `;
            
            // Create maintenance prediction chart
            const maintenanceCtx = document.getElementById('maintenanceChart').getContext('2d');
            new Chart(maintenanceCtx, {
                type: 'bar',
                data: {
                    labels: ['AST-002', 'AST-005', 'AST-008', 'AST-012', 'AST-015'],
                    datasets: [{
                        label: 'Failure Probability (%)',
                        data: [87, 72, 65, 42, 28],
                        backgroundColor: [
                            '#ea4335',
                            '#fbbc04',
                            '#fbbc04',
                            '#34a853',
                            '#34a853'
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100
                        }
                    }
                }
            });
        } else {
            reportContainer.innerHTML = `
                <h3>${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report</h3>
                <p>AI-generated report for ${timePeriod === '1month' ? 'the last month' : 
                   timePeriod === '3months' ? 'the last 3 months' : 
                   timePeriod === '6months' ? 'the last 6 months' : 'the last year'}.</p>
                <p>This is a placeholder for the ${reportType} report content.</p>
                <div class="chart-container">
                    <canvas id="reportChart"></canvas>
                </div>
            `;
            
            // Create generic report chart
            const reportCtx = document.getElementById('reportChart').getContext('2d');
            new Chart(reportCtx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                    datasets: [{
                        label: 'Data Points',
                        data: [12, 19, 3, 5, 2, 3],
                        borderColor: '#1a73e8',
                        tension: 0.1,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }
    }, 1500);
});

    // Initialize the application
    populateAssetTable();
    populateInventoryTable();
    initCharts();

    // Add status badge styles
    const style = document.createElement('style');
    style.textContent = `
        .status-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        .status-badge.success {
            background-color: rgba(52, 168, 83, 0.1);
            color: #34a853;
        }
        .status-badge.warning {
            background-color: rgba(251, 188, 4, 0.1);
            color: #fbbc04;
        }
        .status-badge.danger {
            background-color: rgba(234, 67, 53, 0.1);
            color: #ea4335;
        }
        .btn-icon {
            background: none;
            border: none;
            color: var(--gray-600);
            cursor: pointer;
            font-size: 1rem;
            padding: 0.25rem;
            transition: var(--transition);
        }
        .btn-icon:hover {
            color: var(--primary-color);
        }
        .scan-success {
            background-color: rgba(52, 168, 83, 0.1);
            border-left: 4px solid #34a853;
            padding: 1rem;
            border-radius: 4px;
        }
        .scan-success h4 {
            color: #34a853;
            margin-bottom: 0.5rem;
        }
    `;
    document.head.appendChild(style);
});