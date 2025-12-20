# How to Create GitHub Release

## ✅ [x] AUTOMATED - Releases Now Automatic via GitHub Actions

**Good News:** Manual releases are no longer needed! Releases are now automatically created when you push to the `main` branch.

### How It Works:
1. Push code to `main` branch
2. GitHub Actions automatically:
   - Creates a version tag
   - Builds for Windows, macOS Intel, and macOS ARM
   - Creates a GitHub release with all installers
   - Generates changelog automatically

### Automated Release Workflow:
- **File:** `.github/workflows/release.yml`
- **Triggers:** Push to `main` branch
- **Builds:** Windows x64, macOS ARM64, macOS Intel
- **Artifacts:** Automatically uploaded to GitHub Releases

---

## 📝 Manual Release Instructions (Legacy/Backup)

### 1. Go to GitHub Releases Page
Visit: https://github.com/amirelhalabi/Liratek/releases/new

### 2. Fill in Release Details

**Choose a tag:** Select `v1.0.0` from the dropdown (existing tag)

**Release title:** 
```
LiraTek v1.0.0 - Initial Release 🎉
```

**Description:**
Copy the entire content from `GITHUB_RELEASE_DESCRIPTION.md` file

### 3. Upload Release Assets

Click "Attach binaries" and upload these 4 files from the `release/` folder:

1. **LiraTek-1.0.0-x64.exe** (94 MB)
   - Keep name as is
   
2. **LiraTek-1.0.0-arm64.dmg** (122 MB)
   - Keep name as is
   
3. **LiraTek-1.0.0.dmg** (127 MB)
   - Keep name as is
   
4. **LiraTek-1.0.0-mac.zip** (122 MB)
   - Keep name as is

### 4. Release Options

- ✅ Check "Set as the latest release"
- ✅ Check "Create a discussion for this release" (optional but recommended)
- ⬜ Leave "Set as a pre-release" unchecked

### 5. Publish

Click **"Publish release"** button

---

## 🎯 Quick Checklist (For Manual Releases)

Before publishing manually, verify:
- [ ] Tag version follows semantic versioning
- [ ] Title includes emoji and version
- [ ] Description is complete and formatted
- [ ] All platform files are uploaded (Windows, macOS ARM, macOS Intel)
- [ ] File names match the description links
- [ ] "Latest release" is checked
- [ ] "Pre-release" is NOT checked

**Note:** With automated releases, this checklist is handled automatically by GitHub Actions.

---

## 📦 Files to Upload

From your `release/` folder:

```bash
release/
├── LiraTek-1.0.0-x64.exe         → Keep as is
├── LiraTek-1.0.0-arm64.dmg       → Keep as is
├── LiraTek-1.0.0.dmg             → Keep as is
└── LiraTek-1.0.0-mac.zip         → Keep as is
```

---

## 🔗 After Publishing

Your release will be available at:
https://github.com/amirelhalabi/Liratek/releases/tag/v1.0.0

Download links will be:
- Windows: `https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0-x64.exe`
- macOS ARM: `https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0-arm64.dmg`
- macOS Intel: `https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0.dmg`
- macOS ZIP: `https://github.com/amirelhalabi/Liratek/releases/download/v1.0.0/LiraTek-1.0.0-mac.zip`

---

## 🎉 Share Your Release

Once published, you can share:
- Direct link: `https://github.com/amirelhalabi/Liratek/releases/latest`
- On social media
- With your users/customers

---

## 💡 Tips

1. **Test Downloads:** After publishing, test downloading each file to ensure they work
2. **Update README:** Consider adding a "Download" badge linking to latest release
3. **Announce:** Create a discussion post or social media announcement
4. **Watch Issues:** Monitor GitHub Issues for bug reports from users

---

## 🆘 Need Help?

If you encounter any issues:
1. Files not uploading? Check file sizes and internet connection
2. Tag not found? Ensure `git push --tags` was run
3. Links broken? Verify file names match exactly

---

**Ready to publish?** Go to: https://github.com/amirelhalabi/Liratek/releases/new
