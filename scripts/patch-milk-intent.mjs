import fs from 'node:fs';
const path='api/telegram.js';
let s=fs.readFileSync(path,'utf8');
const old="(chocolate|ao leite|doce de leite|creme de leite|leite condensado|leite em po|leite po|leite fermentado|cafe com leite|bebida lactea|sabonete|desodorante|racao|leite de coco|pudim)";
const neu="(chocolate|ao leite|doce de leite|creme de leite|leite condensado|leite em po|leite po|leite fermentado|cafe com leite|bebida lactea|sabonete|desodorante|racao|alimento para gato|alimento para gatos|alimento para cao|alimento para caes|whiskas|pedigree|leite de coco|pudim)";
if(!s.includes(old)) throw new Error('target not found');
s=s.replace(old,neu);
fs.writeFileSync(path,s);
console.log('patched milk intent exclusions');
