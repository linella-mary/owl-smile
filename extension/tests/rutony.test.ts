import { describe, expect, it } from 'vitest';
import { buildZip, crc32, nextManifest, planExport, type RutonyFile } from '../src/shared/rutony';

const file = (code: string, oid = `oid-${code}`, ext = 'png'): RutonyFile => ({ name: `${code}.${ext}`, code, oid });
const names = (fs: RutonyFile[]) => fs.map((f) => f.name);

describe('planExport', () => {
  it('в пустую папку пишет всё', () => {
    const p = planExport([file('OwlYes'), file('OwlNo')], {}, []);
    expect(names(p.write)).toEqual(['OwlYes.png', 'OwlNo.png']);
    expect(p.remove).toEqual([]);
    expect(p.skipped).toEqual([]);
  });

  it('не трогает то, что уже выгружено и не поменялось', () => {
    const p = planExport([file('OwlYes')], { 'OwlYes.png': 'oid-OwlYes' }, ['OwlYes.png']);
    expect(p.write).toEqual([]);
    expect(names(p.unchanged)).toEqual(['OwlYes.png']);
  });

  it('перезаписывает смайл, у которого сменилась картинка', () => {
    const p = planExport([file('OwlYes', 'new')], { 'OwlYes.png': 'old' }, ['OwlYes.png']);
    expect(names(p.write)).toEqual(['OwlYes.png']);
    expect(p.remove).toEqual([]);
  });

  it('удаляет свои файлы удалённых смайлов, но не файлы стримера', () => {
    const p = planExport([file('OwlYes')], { 'OwlYes.png': 'oid-OwlYes', 'OwlOld.gif': 'x' }, ['OwlYes.png', 'OwlOld.gif', 'MyOwn.png', 'readme.txt']);
    expect(p.remove).toEqual(['OwlOld.gif']);
  });

  it('пропускает код, если у стримера уже есть свой файл с таким именем (любое расширение и регистр)', () => {
    const p = planExport([file('Kappa'), file('LUL', undefined, 'gif'), file('OwlYes')], {}, ['kappa.gif', 'LUL.png']);
    expect(p.skipped.map((f) => f.code)).toEqual(['Kappa', 'LUL']);
    expect(names(p.write)).toEqual(['OwlYes.png']);
  });

  it('снова пишет файл, который стример удалил из папки', () => {
    const p = planExport([file('OwlYes')], { 'OwlYes.png': 'oid-OwlYes' }, []);
    expect(names(p.write)).toEqual(['OwlYes.png']);
  });

  it('при смене формата удаляет старый файл и пишет новый', () => {
    const p = planExport([file('OwlYes', 'o', 'png')], { 'OwlYes.webp': 'o' }, ['OwlYes.webp']);
    expect(p.remove).toEqual(['OwlYes.webp']);
    expect(names(p.write)).toEqual(['OwlYes.png']);
    expect(p.skipped).toEqual([]);
  });

  it('переименование только регистром: удалить старое имя и записать новое', () => {
    const p = planExport([file('OwlYES', 'o')], { 'OwlYes.png': 'o' }, ['OwlYes.png']);
    expect(p.remove).toEqual(['OwlYes.png']);
    expect(names(p.write)).toEqual(['OwlYES.png']);
  });

  it('манифест после выгрузки — записанные и не изменившиеся', () => {
    const p = planExport([file('A1x'), file('B2x')], { 'A1x.png': 'oid-A1x' }, ['A1x.png']);
    expect(nextManifest(p, p.write)).toEqual({ 'A1x.png': 'oid-A1x', 'B2x.png': 'oid-B2x' });
    // Не записанный файл в манифест не попадает — в следующий раз попробуем снова
    expect(nextManifest(p, [])).toEqual({ 'A1x.png': 'oid-A1x' });
  });
});

describe('buildZip', () => {
  it('crc32 совпадает с эталоном', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('собирает читаемый архив', () => {
    const files = [
      { name: 'OwlYes.png', bytes: new Uint8Array([1, 2, 3, 4]) },
      { name: 'OwlNo.gif', bytes: new Uint8Array([9, 8, 7]) },
    ];
    const zip = buildZip(files);
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

    // Конец архива: число файлов и где начинается оглавление
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    let pos = v.getUint32(end + 16, true);

    const dec = new TextDecoder();
    for (const f of files) {
      expect(v.getUint32(pos, true)).toBe(0x02014b50);
      const crc = v.getUint32(pos + 16, true);
      const size = v.getUint32(pos + 20, true);
      const nameLen = v.getUint16(pos + 28, true);
      const local = v.getUint32(pos + 42, true);
      expect(dec.decode(zip.subarray(pos + 46, pos + 46 + nameLen))).toBe(f.name);
      expect(crc).toBe(crc32(f.bytes));

      // Локальный заголовок и сами данные
      expect(v.getUint32(local, true)).toBe(0x04034b50);
      const localName = v.getUint16(local + 26, true);
      const data = zip.subarray(local + 30 + localName, local + 30 + localName + size);
      expect([...data]).toEqual([...f.bytes]);
      pos += 46 + nameLen;
    }
  });
});
