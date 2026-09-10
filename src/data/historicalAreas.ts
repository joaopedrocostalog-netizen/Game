export type AreaConfidence = 'high' | 'medium' | 'estimated';

export type HistoricalArea = {
  id: string;
  name: string;
  entityId: string;
  fromYear: number;
  toYear?: number;
  confidence: AreaConfidence;
  note: string;
  // Schematic lon/lat polygon. These are gameplay placeholders, not final researched borders.
  polygon: Array<[number, number]>;
};

export const historicalAreas: HistoricalArea[] = [
  { id:'area-portugal-1500', name:'Portugal continental', entityId:'portugal-1500', fromYear:1450, toYear:1580, confidence:'high', note:'Contorno esquemático; será substituído por fronteira histórica vetorial pesquisada.', polygon:[[-9.5,42.1],[-6.2,41.9],[-6.3,37.0],[-8.9,37.0],[-9.5,39.2]] },
  { id:'area-castile-1500', name:'Coroa de Castela', entityId:'castile-1500', fromYear:1479, toYear:1516, confidence:'medium', note:'Área esquemática para prototipagem da camada temporal.', polygon:[[-7.4,43.4],[-1.4,43.2],[0.1,41.0],[-1.0,37.0],[-5.7,36.0],[-7.4,38.4]] },
  { id:'area-aragon-1500', name:'Coroa de Aragão', entityId:'aragon-1500', fromYear:1479, toYear:1516, confidence:'medium', note:'Área esquemática; inclui apenas núcleo ibérico no protótipo.', polygon:[[-1.2,42.9],[3.4,42.5],[0.6,38.5],[-1.3,38.7]] },
  { id:'area-france-1500', name:'Reino da França', entityId:'france-1500', fromYear:1498, toYear:1515, confidence:'medium', note:'Fronteira simplificada para visualização inicial.', polygon:[[-4.8,48.7],[1.8,51.0],[7.7,48.5],[7.1,43.2],[2.0,42.3],[-1.8,43.2]] },
  { id:'area-england-1500', name:'Reino da Inglaterra', entityId:'england-1500', fromYear:1485, toYear:1603, confidence:'medium', note:'Contorno simplificado da Inglaterra no protótipo.', polygon:[[-5.8,50.0],[1.6,51.0],[0.2,55.7],[-3.2,55.8],[-5.8,53.0]] },
  { id:'area-scotland-1500', name:'Reino da Escócia', entityId:'scotland-1500', fromYear:1406, toYear:1603, confidence:'medium', note:'Contorno simplificado para protótipo.', polygon:[[-6.2,55.6],[-1.6,55.6],[-2.0,58.8],[-5.7,58.7]] },
  { id:'area-hre-1500', name:'Sacro Império Romano', entityId:'hre-1500', fromYear:1493, toYear:1519, confidence:'estimated', note:'Apenas envelope visual: o Sacro Império será dividido em numerosos Estados e territórios.', polygon:[[5.0,46.0],[15.0,46.2],[16.8,50.5],[13.4,54.7],[7.0,54.5],[5.0,50.5]] },
  { id:'area-venice-1500', name:'República de Veneza', entityId:'venice-1500', fromYear:1454, toYear:1509, confidence:'medium', note:'Núcleo adriático esquemático.', polygon:[[11.5,44.7],[13.8,45.1],[13.6,46.5],[11.7,46.4]] },
  { id:'area-ottoman-1500', name:'Império Otomano', entityId:'ottoman-1500', fromYear:1481, toYear:1512, confidence:'medium', note:'Núcleo balcânico-anatólio esquemático; fronteiras finais serão vetoriais e temporais.', polygon:[[18.0,41.8],[28.5,46.0],[42.5,40.5],[41.0,36.0],[29.0,35.5],[20.0,39.0]] },
  { id:'area-mamluk-1500', name:'Sultanato Mameluco', entityId:'mamluk-1500', fromYear:1250, toYear:1517, confidence:'medium', note:'Egito e Levante representados de forma esquemática.', polygon:[[24.5,31.5],[31.0,32.0],[36.8,34.0],[38.5,30.0],[35.0,27.0],[33.0,22.0],[25.0,22.0]] },
  { id:'area-muscovy-1500', name:'Grão-Principado de Moscou', entityId:'muscovy-1500', fromYear:1462, toYear:1547, confidence:'estimated', note:'Envelope territorial simplificado.', polygon:[[30.0,54.0],[47.0,53.5],[50.0,61.5],[35.0,62.5]] },
  { id:'area-poland-1500', name:'Reino da Polônia', entityId:'poland-1500', fromYear:1492, toYear:1501, confidence:'estimated', note:'Área esquemática; relações dinásticas e fronteiras serão refinadas.', polygon:[[14.0,49.0],[24.0,49.0],[23.5,54.7],[15.0,54.7]] },
  { id:'area-lithuania-1500', name:'Grão-Ducado da Lituânia', entityId:'lithuania-1500', fromYear:1492, toYear:1506, confidence:'estimated', note:'Área esquemática para protótipo.', polygon:[[22.0,49.5],[34.0,50.0],[32.0,57.0],[22.0,56.0]] },
  { id:'area-ming-1500', name:'Império Ming', entityId:'ming-1500', fromYear:1487, toYear:1505, confidence:'estimated', note:'Envelope territorial simplificado; províncias internas serão adicionadas depois.', polygon:[[99.0,22.0],[112.0,18.0],[123.0,27.0],[126.0,41.0],[118.0,46.0],[103.0,41.0],[96.0,31.0]] },
  { id:'area-delhi-1500', name:'Sultanato de Délhi (Lodi)', entityId:'delhi-1500', fromYear:1451, toYear:1526, confidence:'estimated', note:'Área esquemática do domínio Lodi.', polygon:[[72.0,25.0],[80.5,24.0],[82.0,31.5],[74.0,33.0]] },
  { id:'area-vijayanagara-1500', name:'Império Vijayanagara', entityId:'vijayanagara-1500', fromYear:1485, toYear:1565, confidence:'estimated', note:'Área meridional esquemática.', polygon:[[74.0,10.0],[80.0,10.5],[80.5,17.5],[75.0,18.0],[73.0,14.0]] },
  { id:'area-ethiopia-1500', name:'Império Etíope', entityId:'ethiopia-1500', fromYear:1494, toYear:1508, confidence:'estimated', note:'Envelope territorial aproximado para protótipo.', polygon:[[35.0,8.0],[43.0,8.0],[44.0,14.5],[37.0,15.0]] },
  { id:'area-songhai-1500', name:'Império Songhai', entityId:'songhai-1500', fromYear:1493, toYear:1528, confidence:'estimated', note:'Área de influência/controle esquemática.', polygon:[[-5.0,12.0],[5.0,11.0],[4.0,18.0],[-3.0,19.0]] },
  { id:'area-kongo-1500', name:'Reino do Kongo', entityId:'kongo-1500', fromYear:1483, toYear:1540, confidence:'estimated', note:'Área esquemática do núcleo do reino.', polygon:[[11.0,-8.0],[17.0,-8.0],[17.0,-3.0],[12.0,-3.0]] },
  { id:'area-aztec-1500', name:'Tríplice Aliança Mexica', entityId:'aztec-1500', fromYear:1428, toYear:1521, confidence:'estimated', note:'Área esquemática do domínio/tributação mesoamericano.', polygon:[[-101.0,17.0],[-96.0,17.0],[-96.0,21.5],[-100.5,21.5]] },
  { id:'area-inca-1500', name:'Tawantinsuyu', entityId:'inca-1500', fromYear:1493, toYear:1527, confidence:'estimated', note:'Área andina esquemática do Império Inca.', polygon:[[-81.0,-20.0],[-72.0,-20.0],[-70.0,-4.0],[-76.0,1.0],[-80.0,-5.0]] },
];

export function areasForYear(year: number) {
  return historicalAreas.filter((area) => area.fromYear <= year && (area.toYear === undefined || area.toYear >= year));
}
