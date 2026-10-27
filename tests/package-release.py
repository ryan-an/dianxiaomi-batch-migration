"""Build an unpacked browser-extension ZIP with manifest.json at its root."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import re

root = Path(__file__).resolve().parent.parent
extension = root / 'extension'
manifest = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
output = root / 'dist' / f'店小秘迁移助手-浏览器插件-v{version}.zip'
output.parent.mkdir(exist_ok=True)
files = sorted(p for p in extension.rglob('*') if p.is_file() and p.suffix.lower() in {'.js', '.json', '.html', '.css', '.txt', '.png', '.svg'})
required = {'manifest.json', manifest['background']['service_worker'], 'workflow.js', 'popup.html', 'popup.css', 'vendor/LICENSE-SheetJS.txt'}
icon_files = set(manifest.get('icons', {}).values()) | set(manifest.get('action', {}).get('default_icon', {}).values())
required.update(icon_files)
for entry in manifest['content_scripts']:
    required.update(entry.get('js', []))
    required.update(entry.get('css', []))
for call in re.findall(r'importScripts\(([^)]*)\)', (extension / manifest['background']['service_worker']).read_text(encoding='utf-8')):
    required.update(re.findall(r'''["']([^"']+)["']''', call))
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        if not file.resolve().is_relative_to(extension.resolve()):
            raise RuntimeError(f'File outside extension: {file}')
        archive.write(file, file.relative_to(extension).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    names = set(archive.namelist())
    assert json.loads(archive.read('manifest.json'))['version'] == version
    assert required <= names, f'Missing runtime files: {required - names}'
    assert not any(name.startswith(('extension/', 'docs/', 'tests/', 'outputs/', 'dist/', 'artifact-work/')) for name in names)
    assert not any(name.endswith(('.zip', '.xls', '.xlsx', '.log')) for name in names)
    assert {name for name in names if name.endswith('.png')} <= icon_files
    assert 'panel-window.js' not in names
print(f'{output} | {output.stat().st_size:,} bytes | {len(files)} extension files | root manifest and ZIP integrity verified')
