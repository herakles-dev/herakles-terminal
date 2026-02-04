#!/usr/bin/env python3
"""
Generate custom AI thumbnails for Project Navigator using Gemini.

Uses the image-gen-suite GeminiProvider to create unique app icons
for projects that don't have thumbnails yet.

Usage:
    python generate-thumbnails.py              # Generate all missing
    python generate-thumbnails.py --project ai-research  # Single project
    python generate-thumbnails.py --dry-run    # Show what would be generated
"""

import os
import sys
import json
import asyncio
import argparse
from pathlib import Path

# Add image-gen-suite to path
sys.path.insert(0, '/home/hercules/image-gen-suite')

from providers.gemini import GeminiProvider
from PIL import Image

# Paths
REGISTRY_PATH = Path('/home/hercules/system-apps-config/APPS_REGISTRY.json')
THUMBNAILS_DIR = Path('/home/hercules/herakles-terminal/public/thumbnails')
HERCULES_HOME = Path('/home/hercules')
OUTPUT_SIZE = (256, 256)

# Directories to exclude from filesystem discovery
EXCLUDED_DIRS = {
    'node_modules', '.git', '.cache', '.local', '.config', '.npm', '.cargo',
    '.rustup', 'go', 'snap', '.vscode', '.cursor', 'bin', 'logs', 'backups',
    'archive', 'docs', 'config', 'plugins', 'maintenance', 'infrastructure',
    'monitoring', 'observability', 'incidents', 'deployment-strategy', 'demo-app-test',
    'app', 'agents', 'claude', 'claude-configs', 'gemini', 'panns_data',
}

# Category to visual style mapping
CATEGORY_STYLES = {
    'development': 'modern tech gradient with code symbols, dark background',
    'infrastructure': 'industrial metallic style with gears and circuits',
    'media': 'vibrant colorful audio/video waves, dynamic composition',
    'research': 'scientific minimalist with data visualization elements',
    'automation': 'robotic mechanical style with flowing automation lines',
    'security': 'shield and lock motifs, cyber security aesthetic, dark blue',
    'finance': 'clean financial charts, gold and green accents',
    'productivity': 'organized workspace elements, clean and professional',
    'gaming': 'vibrant gaming aesthetic with controller elements',
    'mobile': 'smartphone silhouette, modern app icon style',
    'ai': 'neural network nodes, futuristic AI brain visualization',
    'database': 'structured data blocks, organized grid patterns',
    'monitoring': 'dashboard gauges and metrics, observability theme',
    'streaming': 'flowing media streams, broadcast/radio waves',
    'visualization': '3D graphics, data charts, colorful renders',
}

# Project-specific visual overrides (for more accurate icons)
PROJECT_VISUALS = {
    'audio-player': 'audio waveform equalizer with glowing neon bars, music player interface',
    'browser-automation': 'robotic browser window with cursor automation arrows',
    'gemini-experiments': 'two-faced Gemini constellation, AI stars and neural paths',
    'h1-security-lab': 'white hat hacker theme, security terminal, green on black',
    'hercules-viz': 'muscular hercules silhouette made of data particles, strength visualization',
    'math-visualization': '3D geometric shapes, mathematical equations floating in space',
    'poop-tracker-db': 'playful poop emoji with database icons, humorous tech style',
    'reverse-engineering': 'binary code deconstructing, circuit board analysis',
    'weather-dashboard': 'weather icons (sun, clouds, rain) in dashboard widget style',
    'xmas-shopping': 'holiday shopping bags with christmas ornaments, festive colors',
    'legal-defense-db': 'scales of justice with document/database iconography',
    'supercollider-samples': 'audio waveforms colliding, particle physics meets sound',
    'music-training': 'musical notes with neural network, AI music learning',
    'octobot': 'friendly octopus robot, crypto trading tentacles, mechanical sea creature',
    'novnc': 'remote desktop window inside browser, VNC connection visualization',
    'portainer': 'docker whale with container management interface',
    'frankenstein': 'classic frankenstein monster silhouette, lightning bolts, laboratory',
    'comedic-study': 'comedy masks (tragedy/comedy) with study/book elements',
    'fiber-design-portal': 'fiber optic cables glowing, network design blueprint',
    'gpu-stem-separation': 'GPU chip separating audio stems, layered sound waves',
    'android-emulator': 'android robot inside screen frame, emulation layers',
    'piscitelli-case': 'legal gavel with case files, courtroom document theme',
    'ice-rights-api': 'immigration rights symbol, API connection lines, protective shield',
    'job-search': 'magnifying glass over resume/job listings, career path arrows',
    'house-oversight-data': 'government building with data streams, transparency theme',
    'monetization': 'money/coins transforming into digital currency, revenue streams',
    'riz-engagement': 'engagement/connection hearts with social media elements',
    'tiktok-validation-guide': 'tiktok-style video frame with checkmark validation',
    'tos-analyzer-project': 'document scanner analyzing terms of service, legal text',
    'x-twitter-automation': 'twitter/X bird silhouette with automation gears',
    'ckreynolds-tax': 'tax forms with calculator, financial documents organization',
    'open-hardware-research': 'open-source hardware logos, circuit schematics, maker theme',
    'pvc-ocr': 'document with text being scanned, OCR recognition visualization',
    'high-performance-viz': 'high-speed data visualization, performance metrics racing',
    'hercules-file-explorer-3d': '3D file system tree, folder navigation in 3D space',
    'gmail-mcp-server': 'email envelope with server/API connection lines',
    # Additional filesystem projects
    'couples-calendar': 'two hearts calendar with shared events, romantic planning app',
    'claude-trader-pro': 'AI trading bot with stock charts, neural network trading',
    'closet-manager': 'wardrobe closet organizer with clothing icons, fashion app',
    'cta-tracker': 'Chicago transit train tracker, CTA map with real-time positions',
    'cyber_security_research': 'cybersecurity shield with binary code, hacking research',
    'h1-expert-v5': 'bug bounty hunter badge, HackerOne security expert',
    'halp-cognitive-brain': 'HAL 9000 eye with neural network, AI assistant brain',
    'haz-design-planner': 'hazmat design blueprint, safety planning',
    'hercules-launch': 'rocket launching with hercules strength, startup launcher',
    'Hercules_meta_security': 'meta security layers, recursive protection shields',
    'holy-shit-project': 'meditation toilet emoji with zen garden, humor wellness app',
    'ice-rights-frontend': 'immigration rights UI with protective shield interface',
    'image-gen-suite': 'AI paintbrush creating images, generative art studio',
    'catvton-lambda-sessions': 'virtual try-on clothing with AI, fashion tech',
    'ckreynolds-migration': 'data migration arrows, database transfer flow',
    'Claude_Autonomous_Scraper': 'autonomous web scraper robot, AI data collector',
    'CLAUDE-META-USAGE': 'Claude AI usage analytics dashboard, meta statistics',
    'Competitions': 'trophy podium with coding challenge, hackathon competition',
    'Dirt-Samples': 'audio sample waveforms, music production dirt effects',
    'fiber-tree': 'fiber optic tree structure, network topology visualization',
    'Frankenstein': 'classic frankenstein monster silhouette, lightning bolts, laboratory',
    'Gemini': 'Gemini constellation twins, AI dual-faced stars',
    'gemini-3-pro-setup': 'Gemini Pro setup wizard, AI configuration gears',
    'Gmail-MCP-Server': 'Gmail envelope with MCP server connections',
    'gpu-bridge': 'GPU chip bridge connecting systems, hardware acceleration',
    'Browser_Automation': 'browser window with robotic arms, web automation',
    'architecture-improvement-2025': 'architectural blueprints with 2025, system design',
    'audio-system': 'audio system speakers with equalizer, sound engineering',
    'authelia': 'authentication lock with user verification, SSO security',
    'nuclei-templates': 'security scan templates, vulnerability detection patterns',
    'OctoBot': 'friendly octopus robot, crypto trading tentacles, mechanical sea creature',
    'noVNC': 'remote desktop window inside browser, VNC connection visualization',
    'job-search-project': 'magnifying glass over resume/job listings, career path arrows',
    'piscitelli-vs-bursiaga': 'legal gavel with case files, courtroom document theme',
}


def load_registry():
    """Load the apps registry."""
    with open(REGISTRY_PATH) as f:
        return json.load(f)


def format_project_name(dir_name: str) -> str:
    """Format directory name as project name."""
    return dir_name.replace('-', ' ').replace('_', ' ').title()


def discover_filesystem_projects() -> list:
    """Discover projects from filesystem."""
    projects = []

    for entry in HERCULES_HOME.iterdir():
        if not entry.is_dir():
            continue
        if entry.name.startswith('.'):
            continue
        if entry.name in EXCLUDED_DIRS:
            continue

        # Check if it looks like a project (has code files)
        has_code = any([
            (entry / 'package.json').exists(),
            (entry / 'requirements.txt').exists(),
            (entry / 'Cargo.toml').exists(),
            (entry / 'go.mod').exists(),
            (entry / 'docker-compose.yml').exists(),
            (entry / 'docker-compose.yaml').exists(),
            (entry / 'Dockerfile').exists(),
            (entry / 'CLAUDE.md').exists(),
            (entry / 'README.md').exists(),
            (entry / 'src').is_dir() if (entry / 'src').exists() else False,
        ])

        if has_code:
            projects.append({
                'id': entry.name,
                'name': format_project_name(entry.name),
                'path': str(entry),
                'category': 'development',
            })

    return projects


def get_missing_thumbnails(registry):
    """Find projects without thumbnails from both registry and filesystem."""
    existing = {p.stem for p in THUMBNAILS_DIR.glob('*.png')}
    missing = []
    seen_ids = set()

    # First add registry projects
    for app in registry.get('apps', []):
        app_id = app.get('id', '')
        if app_id and app_id not in existing:
            missing.append(app)
            seen_ids.add(app_id)

    # Then add filesystem projects not in registry
    fs_projects = discover_filesystem_projects()
    for proj in fs_projects:
        proj_id = proj['id']
        if proj_id not in existing and proj_id not in seen_ids:
            missing.append(proj)
            seen_ids.add(proj_id)

    return missing


def create_prompt(app):
    """Create an image generation prompt for an app."""
    app_id = app.get('id', 'unknown')
    name = app.get('name', app_id)
    description = app.get('description', '')
    category = app.get('category', 'development')

    # Check for project-specific visual
    if app_id in PROJECT_VISUALS:
        visual_desc = PROJECT_VISUALS[app_id]
    else:
        # Use category style with name/description hints
        category_style = CATEGORY_STYLES.get(category, CATEGORY_STYLES['development'])
        visual_desc = f"{category_style}, representing {name}"
        if description:
            visual_desc += f" ({description[:50]})"

    # Build the full prompt
    prompt = f"""Create a modern app icon for "{name}": {visual_desc}.

Style requirements:
- Square format app icon (256x256)
- Modern flat design with subtle gradients
- Dark background (#0a0a0f to #1a1a2e gradient)
- Vibrant accent colors (cyan #00d4ff, purple #8b5cf6, or category-appropriate)
- Single centered symbolic element
- No text or letters
- Clean minimalist composition
- Slight glow/neon effect on key elements
- Professional software/app aesthetic"""

    return prompt


async def generate_thumbnail(provider, app, dry_run=False):
    """Generate a thumbnail for a single app."""
    app_id = app.get('id', 'unknown')
    name = app.get('name', app_id)
    output_path = THUMBNAILS_DIR / f"{app_id}.png"

    prompt = create_prompt(app)

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Generating: {name} ({app_id})")
    print(f"  Prompt: {prompt[:100]}...")

    if dry_run:
        return True

    try:
        result = await provider.generate(
            prompt=prompt,
            size=OUTPUT_SIZE
        )

        # Save the image
        result.image.save(output_path, 'PNG')
        print(f"  Saved: {output_path}")
        return True

    except Exception as e:
        print(f"  ERROR: {e}")
        return False


async def main():
    parser = argparse.ArgumentParser(description='Generate project thumbnails with Gemini')
    parser.add_argument('--project', '-p', help='Generate for specific project ID')
    parser.add_argument('--dry-run', '-n', action='store_true', help='Show prompts without generating')
    parser.add_argument('--all', '-a', action='store_true', help='Regenerate all thumbnails')
    parser.add_argument('--batch', '-b', type=int, default=5, help='Batch size (default: 5)')
    args = parser.parse_args()

    # Ensure thumbnails directory exists
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

    # Load registry
    registry = load_registry()

    # Determine which projects to process
    if args.project:
        # Single project
        apps = [a for a in registry.get('apps', []) if a.get('id') == args.project]
        if not apps:
            print(f"Project not found: {args.project}")
            return 1
    elif args.all:
        # All projects
        apps = registry.get('apps', [])
    else:
        # Only missing thumbnails
        apps = get_missing_thumbnails(registry)

    if not apps:
        print("No thumbnails to generate!")
        return 0

    print(f"Projects to process: {len(apps)}")

    # Initialize provider (unless dry run)
    provider = None
    if not args.dry_run:
        try:
            provider = GeminiProvider()
            print(f"Using model: {provider.model}")
        except Exception as e:
            print(f"Failed to initialize Gemini: {e}")
            print("Make sure GEMINI_API_KEY is set in environment")
            return 1

    # Process in batches
    success = 0
    failed = 0

    for i in range(0, len(apps), args.batch):
        batch = apps[i:i + args.batch]
        print(f"\n--- Batch {i // args.batch + 1} ({len(batch)} projects) ---")

        for app in batch:
            if await generate_thumbnail(provider, app, args.dry_run):
                success += 1
            else:
                failed += 1

        # Small delay between batches to respect rate limits
        if not args.dry_run and i + args.batch < len(apps):
            print("\nWaiting 2s before next batch...")
            await asyncio.sleep(2)

    print(f"\n{'='*50}")
    print(f"Complete! Success: {success}, Failed: {failed}")

    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
