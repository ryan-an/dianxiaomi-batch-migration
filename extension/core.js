/* Local data helpers. Spreadsheet cells are data, never instructions or code. */
(function (root) {
  'use strict';
  const text = v => v == null ? '' : String(v).trim();
  const norm = v => text(v).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  const alias = Object.freeze({ '万万欣UK|英国': '万万欣DE' });
  function normalizeSite(value) {return ['uk','英国'].includes(norm(value))?'英国':text(value);}
  function sameSite(a,b) {return norm(normalizeSite(a))===norm(normalizeSite(b));}
  function siteInText(value,site) {
    const s=text(value).normalize('NFKC').replace(/「[^」]*」/g,' ');
    if(sameSite(site,'英国'))return /英国|(?:^|[^\p{L}\p{N}])uk(?=$|[^\p{L}\p{N}])/iu.test(s);
    return !!text(site)&&s.includes(text(site));
  }
  function shopForSite(shop,site,aliases=alias) {return aliases[`${shop}|${normalizeSite(site)}`]||aliases[`${shop}|${text(site)}`]||shop;}
  function sourceKey(value) {
    const u = new URL(text(value));
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('链接必须是 http 或 https');
    const asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(u.pathname + '/');
    if (/(^|\.)amazon\.[a-z.]+$/i.test(u.hostname) && asin) return `amazon:${asin[1].toUpperCase()}`;
    u.hash = ''; u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|ref_|tag$)/i.test(k)) u.searchParams.delete(k);
    return u.href.replace(/\/$/, '');
  }
  function parseWorkbook(book, XLSX, options = {}) {
    const sheets = book.SheetNames.map(name => ({name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], {header:1, raw:false, defval:''})}));
    const mains = sheets.map(s => ({...s, headerIndex:s.rows.findIndex(r => r.some(c => /^(美国链接|来源链接|产品链接|链接|source\s*url|url)$/i.test(text(c))) && r.some(c => text(c) === '店铺'))})).filter(s => s.headerIndex >= 0);
    if (mains.length !== 1) throw new Error('需要且只允许一个同时包含“链接”和“店铺”表头的主表');
    const main = mains[0], headers = main.rows[main.headerIndex].map(text);
    if (headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size) throw new Error('主表存在重复列名');
    const linkCol = headers.findIndex(c => /^(美国链接|来源链接|产品链接|链接|source\s*url|url)$/i.test(c));
    const records = main.rows.slice(main.headerIndex+1).map((r,i) => ({sheet:main.name, row:i+main.headerIndex+2, cells:r.slice(), provenance:`${main.name}!${i+main.headerIndex+2}`})).filter(r => r.cells.some(c => text(c)));
    const gaps = records.filter(r => text(r.cells[linkCol]) && headers.every((_,i) => i === linkCol || !text(r.cells[i])));
    const other = sheets.filter(s => s.name !== main.name && s.rows.some(r => r.some(c => text(c))));
    const warnings = [];
    if (gaps.length && options.mergeSplit) {
      const candidates = other.filter(s => s.rows.length === gaps.length && s.rows.every(r => r.length === headers.length-1 && text(r[0]) && !/^https?:/i.test(text(r[0]))));
      if (linkCol !== 0 || candidates.length !== 1) throw new Error('跨表补齐形状不匹配，无法可靠按顺序配对');
      gaps.forEach((r,i) => {r.cells = [r.cells[0], ...candidates[0].rows[i]]; r.provenance += ` + ${candidates[0].name}!${i+1}`;});
      warnings.push(`已按顺序补齐 ${gaps.length} 条跨表数据，结果表保留来源位置`);
    } else if (other.length) warnings.push(`另有 ${other.map(s=>s.name).join('、')} 数据表，未跨表补齐`);
    const seen = new Set();
    const rows = records.map((r,i) => {
      const data = Object.fromEntries(headers.map((h,j)=>[h,text(r.cells[j])]));
      const item = {index:i, data, source:data[headers[linkCol]], provenance:r.provenance, shop:data['店铺'], site:normalizeSite(data['站点']), status:'待执行', step:'解析', error:'', title:'', collectorId:'', productId:'', history:[]};
      try {
        item.key = sourceKey(item.source);
        if (!item.shop || !item.site) throw new Error('缺少店铺或站点');
        if (seen.has(item.key)) throw new Error('来源链接重复，未重复执行');
        seen.add(item.key);
        item.targetShop = shopForSite(item.shop,data['站点'],options.shopAliases || alias);
        if (/[eE][+-]?\d+$/.test(data.UPC || '')) throw new Error('UPC 被写成科学计数法，请恢复完整文本');
      } catch(e) {item.status='数据错误'; item.error=e.message;}
      return item;
    });
    return {rows, warnings, groups:[...new Set(rows.filter(r=>!r.error).map(r=>`${r.targetShop}|${r.site}`))]};
  }
  function uniqueMatch(items, predicate, description) {
    const candidates = items.filter(predicate);
    if (candidates.length !== 1) throw new Error(`${description}：匹配到 ${candidates.length} 条，已停止以免填错产品`);
    return candidates[0];
  }
  function resultTable(rows){
    return [['执行状态','原表链接','采集标题','实际店铺','站点','当前步骤','失败原因','来源位置','原店铺','采集ID','产品ID','提交发布时间','目标页面','执行记录'],...rows.map(r=>[r.status,r.source,r.title,r.targetShop,r.site,r.step,r.error,r.provenance,r.shop,r.collectorId,r.productId,r.publishedAt,r.targetUrl,(r.history||[]).map(x=>`${x.time} ${x.message}`).join('\n')].map(text))];
  }
  function csv(rows) {
    const quote = value => {
      let s = text(value); if (/^[=+\-@\t\r]/.test(s)||/^\d{16,}$/.test(s)) s = "'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    return '\ufeff'+resultTable(rows).map(r=>r.map(quote).join(',')).join('\r\n');
  }
  function unitKey(v) {
    const s = text(v).toLowerCase();
    if (/厘米|centimet|zentimeter|^cm$/.test(s)) return 'cm';
    if (/公斤|kilogram|^kg$/.test(s)) return 'kg';
    if (/毫米|millimet|^mm$/.test(s)) return 'mm';
    if (/英寸|inch/.test(s)) return 'in';
    if (/毫克|milligram/.test(s)) return 'mg';
    if (/盎司|ounce/.test(s)) return 'oz';
    if (/磅|pounds|^lb$/.test(s)) return 'lb';
    if (/克|grams|^g$/.test(s)) return 'g';
    return norm(v);
  }
  const api = {text,norm,alias,normalizeSite,sameSite,siteInText,shopForSite,sourceKey,parseWorkbook,uniqueMatch,resultTable,csv,unitKey};
  root.DXMCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this);
