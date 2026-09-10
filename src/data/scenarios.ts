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
      { id: 'castile-1500', name: 'Coroa de Castela', type: 'Reino', population: '≈ 5,3 mi', treasury: '126', stability: 68, military: 79, technology: 69, culture: 'Castelhana e outras', government: 'Monarquia', specialty: 'Capacidade terrestre, fiscalidade régia e expansão dinástica' },
      { id: 'aragon-1500', name: 'Coroa de Aragão', type: 'Monarquia composta', population: 'estimativa em pesquisa', treasury: '103', stability: 72, military: 68, technology: 72, culture: 'Catalã, aragonesa, valenciana e outras', government: 'Monarquia composta', specialty: 'Mediterrâneo, comércio marítimo e instituições territoriais' },
      { id: 'france-1500', name: 'Reino da França', type: 'Reino', population: 'estimativa em pesquisa', treasury: '148', stability: 72, military: 84, technology: 72, culture: 'Francesa e regionalmente diversa', government: 'Monarquia', specialty: 'População, cavalaria, fiscalidade e consolidação territorial' },
      { id: 'england-1500', name: 'Reino da Inglaterra', type: 'Reino', population: 'estimativa em pesquisa', treasury: '101', stability: 76, military: 69, technology: 71, culture: 'Inglesa', government: 'Monarquia', specialty: 'Administração régia, arqueiros, comércio e poder marítimo em crescimento' },
      { id: 'scotland-1500', name: 'Reino da Escócia', type: 'Reino', population: 'estimativa em pesquisa', treasury: '63', stability: 66, military: 61, technology: 66, culture: 'Escocesa, gaélica e regional', government: 'Monarquia', specialty: 'Defesa territorial, alianças e adaptação a terreno difícil' },
      { id: 'hre-1500', name: 'Sacro Império Romano', type: 'Império descentralizado', population: 'estimativa em pesquisa', treasury: 'descentralizado', stability: 58, military: 78, technology: 76, culture: 'Germânica, italiana, tcheca e outras', government: 'Monarquia eletiva e Estados imperiais', specialty: 'Grande diversidade política, cidades livres e alta capacidade econômica regional' },
      { id: 'venice-1500', name: 'República de Veneza', type: 'República', population: '≈ 1,5 mi', treasury: '118', stability: 83, military: 58, technology: 78, culture: 'Veneziana', government: 'República mercantil', specialty: 'Comércio, finanças mercantis e construção naval' },
      { id: 'ottoman-1500', name: 'Império Otomano', type: 'Império', population: '≈ 11 mi', treasury: '154', stability: 77, military: 90, technology: 74, culture: 'Otomana e multiétnica', government: 'Monarquia imperial', specialty: 'Exército terrestre, artilharia e administração imperial' },
      { id: 'mamluk-1500', name: 'Sultanato Mameluco', type: 'Sultanato', population: 'estimativa em pesquisa', treasury: '132', stability: 64, military: 78, technology: 69, culture: 'Árabe, circassiana e outras', government: 'Sultanato militar', specialty: 'Comércio do Mar Vermelho, cavalaria e controle de rotas orientais' },
      { id: 'muscovy-1500', name: 'Grão-Principado de Moscou', type: 'Principado', population: 'estimativa em pesquisa', treasury: '88', stability: 73, military: 76, technology: 64, culture: 'Russa e eslava oriental', government: 'Monarquia principesca', specialty: 'Centralização, expansão terrestre e mobilização de grandes espaços' },
      { id: 'poland-1500', name: 'Reino da Polônia', type: 'Reino', population: 'estimativa em pesquisa', treasury: '91', stability: 69, military: 72, technology: 70, culture: 'Polonesa e diversa', government: 'Monarquia', specialty: 'Cavalaria, agricultura e instituições nobiliárquicas' },
      { id: 'lithuania-1500', name: 'Grão-Ducado da Lituânia', type: 'Grão-Ducado', population: 'estimativa em pesquisa', treasury: '82', stability: 66, military: 70, technology: 66, culture: 'Lituana, rutena e outras', government: 'Monarquia grão-ducal', specialty: 'Grande extensão territorial e diversidade religiosa e cultural' },
      { id: 'ming-1500', name: 'Império Ming', type: 'Império', population: '≈ 100+ mi', treasury: '221', stability: 71, military: 85, technology: 81, culture: 'Han e outras', government: 'Monarquia imperial', specialty: 'Escala administrativa, manufaturas e população' },
      { id: 'delhi-1500', name: 'Sultanato de Délhi (Lodi)', type: 'Sultanato', population: 'estimativa em pesquisa', treasury: '111', stability: 61, military: 75, technology: 69, culture: 'Indo-persa e diversas tradições regionais', government: 'Sultanato', specialty: 'Cavalaria, administração indo-persa e controle do norte da Índia' },
      { id: 'vijayanagara-1500', name: 'Império Vijayanagara', type: 'Império', population: 'estimativa em pesquisa', treasury: '124', stability: 75, military: 79, technology: 72, culture: 'Kannada, telugu, tâmil e outras', government: 'Monarquia imperial', specialty: 'Comércio do Índico, agricultura irrigada e poder regional' },
      { id: 'ethiopia-1500', name: 'Império Etíope', type: 'Império', population: 'estimativa em pesquisa', treasury: '69', stability: 70, military: 67, technology: 62, culture: 'Amhara, tigrínia e outras', government: 'Monarquia imperial', specialty: 'Resiliência montanhosa, tradição cristã e redes regionais' },
      { id: 'songhai-1500', name: 'Império Songhai', type: 'Império', population: 'estimativa em pesquisa', treasury: '105', stability: 78, military: 77, technology: 65, culture: 'Songhai e outras populações sahelianas', government: 'Monarquia imperial', specialty: 'Comércio transaariano, cavalaria e centros urbanos do Sahel' },
      { id: 'kongo-1500', name: 'Reino do Kongo', type: 'Reino', population: 'estimativa em pesquisa', treasury: '71', stability: 74, military: 61, technology: 60, culture: 'Bakongo e outras', government: 'Monarquia', specialty: 'Redes regionais, centralização política e comércio atlântico emergente' },
      { id: 'aztec-1500', name: 'Tríplice Aliança Mexica', type: 'Império tributário', population: 'estimativa em pesquisa', treasury: '137', stability: 69, military: 84, technology: 67, culture: 'Nahua e diversos povos tributários', government: 'Aliança imperial tributária', specialty: 'Tributação, urbanização mesoamericana e poder militar regional' },
      { id: 'inca-1500', name: 'Tawantinsuyu', type: 'Império', population: 'estimativa em pesquisa', treasury: 'redistributivo', stability: 76, military: 86, technology: 71, culture: 'Quéchua e diversos povos andinos', government: 'Monarquia imperial', specialty: 'Estradas, administração redistributiva e mobilização andina' },
    ],
  },
];
