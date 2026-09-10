export type ScenarioEntity = {
  id: string;
  name: string;
  type: string;
  population: string;
  treasury: string;
  stability: number;
  military: number;
  technology: number;
  culture: string;
  government: string;
  specialty: string;
};

export type Scenario = {
  id: string;
  label: string;
  year: number;
  subtitle: string;
  historicalLayerReady: boolean;
  entities: ScenarioEntity[];
};

export const scenarios: Scenario[] = [
  {
    id: '2026',
    label: 'Mundo Atual',
    year: 2026,
    subtitle: 'Estados modernos, economia global e tecnologia contemporânea',
    historicalLayerReady: true,
    entities: [
      { id: 'brazil', name: 'Brazil', type: 'República federativa', population: '≈ 203 mi', treasury: 'Moderno', stability: 69, military: 67, technology: 76, culture: 'Brasileira e plural', government: 'República presidencialista', specialty: 'Agroindústria, recursos naturais e escala continental' },
      { id: 'portugal-2026', name: 'Portugal', type: 'República', population: '≈ 10,6 mi', treasury: 'Moderno', stability: 82, military: 54, technology: 82, culture: 'Portuguesa', government: 'República semipresidencialista', specialty: 'Integração europeia, serviços e vocação atlântica' },
      { id: 'japan-2026', name: 'Japan', type: 'Estado', population: '≈ 123 mi', treasury: 'Moderno', stability: 86, military: 78, technology: 94, culture: 'Japonesa', government: 'Monarquia constitucional parlamentar', specialty: 'Indústria avançada, engenharia e alta absorção tecnológica' },
      { id: 'china-2026', name: 'China', type: 'República popular', population: '≈ 1,4 bi', treasury: 'Moderno', stability: 84, military: 93, technology: 92, culture: 'Han e diversas minorias', government: 'Estado de partido único', specialty: 'Escala industrial, infraestrutura e capacidade tecnológica' },
      { id: 'usa-2026', name: 'United States of America', type: 'República federativa', population: '≈ 342 mi', treasury: 'Moderno', stability: 75, military: 97, technology: 96, culture: 'Plural', government: 'República presidencialista', specialty: 'Finanças, tecnologia, poder militar e influência global' },
    ],
  },
  {
    id: '1500',
    label: 'Ano 1500',
    year: 1500,
    subtitle: 'Reinos, impérios, cidades-Estado, confederações e povos do período',
    historicalLayerReady: false,
    entities: [
      { id: 'portugal-1500', name: 'Portugal', type: 'Reino', population: '≈ 1,1 mi', treasury: '82', stability: 74, military: 61, technology: 72, culture: 'Portuguesa', government: 'Monarquia', specialty: 'Navegação oceânica, cartografia e exploração marítima' },
      { id: 'castile-1500', name: 'Coroa de Castela', type: 'Reino', population: '≈ 5,3 mi', treasury: '126', stability: 68, military: 79, technology: 69, culture: 'Castelhana e outras', government: 'Monarquia', specialty: 'Capacidade terrestre e expansão dinástica' },
      { id: 'ottoman-1500', name: 'Império Otomano', type: 'Império', population: '≈ 11 mi', treasury: '154', stability: 77, military: 90, technology: 74, culture: 'Otomana e multiétnica', government: 'Monarquia imperial', specialty: 'Exército terrestre, artilharia e administração imperial' },
      { id: 'ming-1500', name: 'Império Ming', type: 'Império', population: '≈ 100+ mi', treasury: '221', stability: 71, military: 85, technology: 81, culture: 'Han e outras', government: 'Monarquia imperial', specialty: 'Escala administrativa, manufaturas e população' },
      { id: 'venice-1500', name: 'República de Veneza', type: 'República', population: '≈ 1,5 mi', treasury: '118', stability: 83, military: 58, technology: 78, culture: 'Veneziana', government: 'República mercantil', specialty: 'Comércio, finanças mercantis e construção naval' },
    ],
  },
];
