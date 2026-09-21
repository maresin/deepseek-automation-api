// tests/data/make-fixture.js
//
// Generate a truncated-JSON fixture from a valid structure.
//
// The result is a valid JSON object missing exactly the last two
// characters (`]}`) — the shape that DeepSeek Web produces when it
// loses track of the outermost frame on long compact output.
//
// Run once to regenerate the fixture:
//     node tests/data/make-fixture.js

const fs = require('fs');
const path = require('path');

const files = [
    {
        path: 'app/globals.css',
        content:
            '@tailwind base;\n' +
            '@tailwind components;\n' +
            '@tailwind utilities;\n\n' +
            ':root {\n' +
            '  --color-primary: #1F3D2B;\n' +
            '  --color-accent: #D96A3B;\n' +
            '}\n\n' +
            '@layer base {\n' +
            '  body { background-color: var(--color-background); }\n' +
            '}\n',
    },
    {
        path: 'app/layout.tsx',
        content:
            "import type { Metadata } from 'next';\n" +
            "import './globals.css';\n\n" +
            "export const metadata: Metadata = { title: 'Aurora' };\n\n" +
            "export default function RootLayout({ children }: { children: React.ReactNode }) {\n" +
            "  return (\n" +
            "    <html lang=\"ru\">\n" +
            "      <body>{children}</body>\n" +
            "    </html>\n" +
            "  );\n" +
            "}\n",
    },
    {
        path: 'components/Hero.tsx',
        content:
            "'use client';\n\n" +
            "import { ArrowRight } from 'lucide-react';\n\n" +
            "export function Hero() {\n" +
            "  return (\n" +
            "    <section className=\"py-8\">\n" +
            "      <h1>Дизайн, который работает</h1>\n" +
            "    </section>\n" +
            "  );\n" +
            "}\n",
    },
    {
        path: 'components/Footer.tsx',
        content:
            "export function Footer() {\n" +
            "  return (\n" +
            "    <footer className=\"bg-background\">\n" +
            "      <p>© 2026 Aurora</p>\n" +
            "    </footer>\n" +
            "  );\n" +
            "}\n",
    },
];

const valid = JSON.stringify({
    tool_calls: [
        {
            name: 'write_files',
            arguments: { files },
        },
    ],
});

// Truncate exactly 2 characters — the outermost `]}`.
const truncated = valid.slice(0, -2);

const outPath = path.join(__dirname, 'truncated-write_files.json');
fs.writeFileSync(outPath, truncated);

console.log('Wrote', outPath);
console.log('Length:', truncated.length);
console.log('Last 20 chars:', JSON.stringify(truncated.slice(-20)));
console.log('Original length:', valid.length);