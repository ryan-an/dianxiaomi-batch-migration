"""Build the local release without development runtime junctions or older archives."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'extension/manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
output = root / 'dist' / f'店小秘迁移助手-v{version}.zip'
output.parent.mkdir(exist_ok=True)
files = [root / 'README.md', root / '迁移数据.xls']
for name in ('extension', 'docs', 'tests', 'outputs'):
    files.extend(p for p in (root / name).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        if not file.resolve().is_relative_to(root):
            raise RuntimeError(f'File outside workspace: {file}')
        archive.write(file, file.relative_to(root).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('extension/manifest.json'))['version'] == version
    assert 'extension/popup.js' in archive.namelist()
    assert 'extension/work-target.js' in archive.namelist()
    assert 'extension/panel-view.js' in archive.namelist()
    assert 'extension/panel-layout.js' in archive.namelist()
    assert 'extension/panel-window.js' not in archive.namelist()
    assert not any('artifact-work/' in name or name.startswith('dist/') for name in archive.namelist())
print(f'{output} | {output.stat().st_size:,} bytes | {len(files)} files | ZIP integrity verified')
