# LiraTek v1.0.0 - Initial Release 🎉

**Release Date:** December 18, 2025  
**Version:** 1.0.0

---

## 📦 Downloads

### Windows

- **[LiraTek-1.0.0-x64.exe](https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0-x64.exe)** (94 MB)
  - Windows 10/11 (64-bit)
  - One-click installer
  - No administrator rights required

### macOS

- **[LiraTek-1.0.0-arm64.dmg](https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0-arm64.dmg)** (122 MB)
  - macOS 12+ (Apple Silicon / M1/M2/M3)
  - Native ARM64 performance

- **[LiraTek-1.0.0.dmg](https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0.dmg)** (127 MB)
  - macOS 12+ (Intel x64)
  - For Intel-based Macs

- **[LiraTek-1.0.0-mac.zip](https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0-mac.zip)** (122 MB)
  - macOS 12+ (Intel x64) - ZIP archive
  - Alternative to DMG installer

---

## 🎯 What is LiraTek?

LiraTek is a comprehensive Point of Sale (POS) system designed specifically for Lebanese phone shops, featuring advanced multi-currency support for handling LBP, USD, and dynamic exchange rates.

### Key Features

#### 💰 **Multi-Currency System**

- **Dual Currency Support:** Lebanese Pound (LBP) and US Dollar (USD)
- **Real-time Exchange Rates:** Dynamic rate management with automatic calculations
- **Currency Exchange Module:** Built-in currency exchange functionality
- **Smart Payment Processing:** Handle mixed-currency transactions seamlessly

#### 📱 **Point of Sale (POS)**

- **Fast Product Search:** Quick barcode scanning and search
- **Shopping Cart:** Real-time cart management with multi-currency display
- **Split Payments:** Accept payments in multiple currencies
- **Receipt Generation:** Professional receipts with dual-currency pricing
- **Sales History:** Complete transaction tracking and reporting

#### 📦 **Inventory Management**

- **Product Catalog:** Comprehensive product database with categories
- **Stock Tracking:** Real-time inventory levels and alerts
- **Product Variants:** Support for different models, colors, and storage sizes
- **Barcode Support:** Fast product identification
- **Low Stock Alerts:** Automatic notifications for reordering

#### 👥 **Customer Management**

- **Client Database:** Complete customer information management
- **Credit System:** Track customer credit and payment history
- **Debt Management:** Monitor outstanding balances and payment schedules
- **Purchase History:** View customer transaction history

#### 💳 **Financial Services**

- **OMT Integration:** Money transfer services
- **Bill Payments:** Utility and service bill management
- **Mobile Recharges:** Top-up services for all Lebanese carriers
- **Service Tracking:** Complete financial service transaction history

#### 📊 **Reporting & Analytics**

- **Sales Reports:** Daily, weekly, and monthly sales analysis
- **Financial Reports:** Revenue, profit margins, and expense tracking
- **Inventory Reports:** Stock levels, turnover rates, and reorder points
- **Custom Date Ranges:** Flexible reporting periods
- **Export Capabilities:** Export reports for accounting

#### 🔐 **Security & User Management**

- **User Authentication:** Secure login system
- **Role-Based Access:** Different permission levels for staff
- **Activity Logging:** Complete audit trail of all actions
- **Data Encryption:** Secure storage of sensitive information

#### 🌙 **Daily Operations**

- **Opening/Closing:** Daily drawer management
- **Cash Drawer Tracking:** Monitor cash flow and reconciliation
- **Shift Management:** Track sales by shift and operator
- **Expense Tracking:** Record and categorize business expenses

#### ⚙️ **Settings & Configuration**

- **Shop Configuration:** Business details and branding
- **Rate Management:** Set and update exchange rates
- **User Management:** Add/edit staff accounts
- **Notification Settings:** Customize alerts and notifications
- **System Diagnostics:** Health checks and troubleshooting tools

---

## 🆕 What's New in v1.0.0

### Core Features

- ✅ Complete POS system with multi-currency support
- ✅ Inventory management with stock tracking
- ✅ Customer database and debt management
- ✅ Financial services (OMT, recharges, bill payments)
- ✅ Comprehensive reporting and analytics
- ✅ User authentication and role-based access
- ✅ Daily operations and cash drawer management
- ✅ **Automated PDF Audit Reports**: Formatted local PDF generation for every closing
- ✅ **Variance Threshold Alerts**: Configurable auditing to flag cash discrepancies
- ✅ Professional receipt and report generation

### Technical Highlights

- ✅ Built with Electron for cross-platform desktop support
- ✅ React 19 with modern TypeScript
- ✅ SQLite database for reliable local data storage
- ✅ Native performance with better-sqlite3
- ✅ Tailwind CSS for modern, responsive UI
- ✅ Comprehensive test coverage
- ✅ Enterprise-grade build configuration

### Platform Support

- ✅ Windows 10/11 (64-bit)
- ✅ macOS 12+ (Apple Silicon ARM64)
- ✅ macOS 12+ (Intel x64)

---

## 📋 System Requirements

### Windows

- **OS:** Windows 10 (64-bit) or Windows 11
- **RAM:** 4 GB minimum, 8 GB recommended
- **Disk Space:** 500 MB for installation
- **Display:** 1280x720 minimum resolution

### macOS

- **OS:** macOS 12 (Monterey) or later
- **RAM:** 4 GB minimum, 8 GB recommended
- **Disk Space:** 500 MB for installation
- **Display:** 1280x720 minimum resolution
- **Architecture:** Apple Silicon (M1/M2/M3) or Intel processors

---

## 🚀 Installation Instructions

### Windows

1. Download `LiraTek-1.0.0-x64.exe`
2. Run the installer
3. Follow the installation wizard
4. Launch LiraTek from the Start Menu or Desktop shortcut

### macOS

1. Download the appropriate DMG file for your Mac:
   - Apple Silicon (M1/M2/M3): `LiraTek-1.0.0-arm64.dmg`
   - Intel: `LiraTek-1.0.0.dmg`
2. Open the DMG file
3. Drag LiraTek to your Applications folder
4. Launch LiraTek from Applications
5. **First Launch:** Right-click the app and select "Open" to bypass Gatekeeper (unsigned app)

**Note for macOS users:** Since this app is not notarized by Apple, you'll need to allow it in System Settings > Privacy & Security on first launch.

---

## 📖 Documentation

- **[DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Complete technical guide, build instructions, and architecture overview.
- **[README.md](README.md)** - Project overview and core features.

---

## 🐛 Known Issues

### macOS

- **Gatekeeper Warning:** App is not notarized, requires manual approval on first launch
  - **Workaround:** Right-click → Open, then approve in System Settings

### General

- First launch may take a few seconds while database initializes
- Rate changes require manual update (no auto-sync in v1.0.0)

---

## 🔮 Coming Soon

### Planned Features

- 🔄 Auto-update mechanism
- 🔐 Apple code signing and notarization
- 📱 Barcode scanner integration
- ☁️ Cloud backup and sync
- 📧 Email receipt delivery
- 📊 Advanced analytics dashboard
- 🌐 Multi-shop support
- 🔔 Low stock email alerts

---

## 🛠️ Technical Details

### Built With

- **Electron** 39.2.7 - Desktop application framework
- **React** 19.2.0 - Frontend UI framework
- **TypeScript** 5.9.3 - Type-safe development
- **Vite** 7.3.0 - Fast build tool
- **better-sqlite3** 12.5.0 - SQLite database driver
- **Tailwind CSS** 4.1.18 - Modern styling
- **Recharts** 3.6.0 - Data visualization

### Security

- Local SQLite database (no cloud dependencies)
- User authentication with password hashing
- Activity logging for audit trails
- Encrypted sensitive data storage

### Performance

- Native performance with SQLite
- Optimized for fast transactions
- Efficient memory usage
- Quick startup time

---

## 💪 Support

### Getting Help

- **Issues:** [GitHub Issues](https://github.com/amirelhalabi/Liratek/issues)
- **Discussions:** [GitHub Discussions](https://github.com/amirelhalabi/Liratek/discussions)

### Reporting Bugs

Please include:

1. Operating system and version
2. Steps to reproduce
3. Expected vs actual behavior
4. Screenshots if applicable

---

## 📄 License

Copyright © 2025 Amir

---

## 🙏 Acknowledgments

Special thanks to the open-source community for the amazing tools and libraries that made this project possible.

---

## 📊 Release Statistics

- **Lines of Code:** 15,000+
- **Test Coverage:** Comprehensive test suite
- **Build Time:** ~2 minutes per platform
- **Supported Platforms:** 3 (Windows x64, macOS ARM64, macOS Intel)
- **Total Package Size:** ~340 MB (all platforms combined)

---

## 🎉 Thank You!

Thank you for choosing LiraTek! We hope this POS system helps streamline your business operations.

For updates and announcements, watch this repository on GitHub.

---

**Download Now:** [v1.0.0 Release](https://github.com/amirelhalabi/Liratek/releases/tag/v1.0.0)
