#!/bin/bash
# T-20 Phase 2: Delete Old Monolithic Structure
# Generated: Jan 24, 2026
# Run this script to clean up old structure after migration

echo "🗑️  T-20 Phase 2: Deleting Old Structure..."
echo ""
echo "⚠️  This will delete:"
echo "  - src/ (old frontend)"
echo "  - electron/ (old backend)"
echo "  - public/, __mocks__/, packages/"
echo "  - Old config files"
echo ""
read -p "Are you sure? Type 'yes' to continue: " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Deleting folders..."
rm -rf src/
rm -rf electron/
rm -rf public/
rm -rf __mocks__/
rm -rf packages/
rm -rf dist/ dist-electron/ build/

echo "Deleting config files..."
rm -f index.html
rm -f vite.config.ts
rm -f tsconfig.json tsconfig.app.json tsconfig.node.json
rm -f jest.config.ts jest.setup.ts
rm -f tailwind.config.js postcss.config.js
rm -f eslint.config.js
rm -f apply-drawer-migration.js
rm -f agent-recent-chat.txt

echo ""
echo "✅ Deletion complete!"
echo ""
echo "Next steps:"
echo "1. git status (review changes)"
echo "2. git add -A"
echo "3. git commit -m 'chore(T-20): Phase 2 - Remove old monolithic structure'"
echo "4. Test: cd frontend && npm run dev"
echo "5. Test: cd backend && npm run dev"
echo ""
echo "To undo: git reset --hard HEAD~1"
