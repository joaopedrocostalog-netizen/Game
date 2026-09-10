export type EconomyProfile = {
  sectors: Array<{ name: string; share: number }>;
  resources: string[];
  trade: string[];
  fiscalLabel: string;
  productionLabel: string;
};

export type PopulationProfile = {
  groups: Array<{ name: string; share: number }>;
  faiths: Array<{ name: string; share: number }>;
  regions: string[];
  socialLabel: string;
};

export type EntityProfile = {
  economy: EconomyProfile;
  population: PopulationProfile;
};

const modern = (groups: PopulationProfile['groups'], faiths: PopulationProfile['faiths'], regions: string[], sectors: EconomyProfile['sectors'], resources: string[], trade: string[]): EntityProfile => ({
  economy: { sectors, resources, trade, fiscalLabel: 'Finanças públicas', productionLabel: 'Estrutura produtiva' },
  population: { groups, faiths, regions, socialLabel: 'Composição social contemporânea' },
});

const earlyModern = (groups: PopulationProfile['groups'], faiths: PopulationProfile['faiths'], regions: string[], sectors: EconomyProfile['sectors'], resources: string[], trade: string[]): EntityProfile => ({
  economy: { sectors, resources, trade, fiscalLabel: 'Tesouro e tributos', productionLabel: 'Produção e ofícios' },
  population: { groups, faiths, regions, socialLabel: 'Estamentos e comunidades' },
});

export const entityProfiles: Record<string, EntityProfile> = {
  brazil: modern(
    [{ name: 'População urbana', share: 87 }, { name: 'População rural', share: 13 }],
    [{ name: 'Cristianismos', share: 76 }, { name: 'Sem religião / outras', share: 24 }],
    ['Sudeste', 'Nordeste', 'Sul', 'Norte', 'Centro-Oeste'],
    [{ name: 'Serviços', share: 59 }, { name: 'Indústria', share: 21 }, { name: 'Agro e recursos', share: 20 }],
    ['Minério de ferro', 'Petróleo', 'Água', 'Terras agrícolas'],
    ['Américas', 'Ásia', 'Europa'],
  ),
  'portugal-2026': modern(
    [{ name: 'População urbana', share: 68 }, { name: 'População rural', share: 32 }],
    [{ name: 'Cristianismos', share: 80 }, { name: 'Sem religião / outras', share: 20 }],
    ['Norte', 'Centro', 'Lisboa', 'Alentejo', 'Algarve', 'Ilhas'],
    [{ name: 'Serviços', share: 66 }, { name: 'Indústria', share: 22 }, { name: 'Agro e mar', share: 12 }],
    ['Recursos marítimos', 'Florestas', 'Agricultura'],
    ['União Europeia', 'Atlântico', 'Lusofonia'],
  ),
  'japan-2026': modern(
    [{ name: 'População urbana', share: 92 }, { name: 'População rural', share: 8 }],
    [{ name: 'Tradições xintoístas/budistas', share: 70 }, { name: 'Outras / sem filiação', share: 30 }],
    ['Honshu', 'Hokkaido', 'Kyushu', 'Shikoku', 'Ryukyu'],
    [{ name: 'Serviços', share: 63 }, { name: 'Indústria avançada', share: 31 }, { name: 'Agro e mar', share: 6 }],
    ['Recursos marítimos', 'Capacidade industrial'],
    ['Ásia-Pacífico', 'Américas', 'Europa'],
  ),
  'china-2026': modern(
    [{ name: 'População urbana', share: 67 }, { name: 'População rural', share: 33 }],
    [{ name: 'Tradições chinesas / sem filiação', share: 76 }, { name: 'Outras religiões', share: 24 }],
    ['Costa oriental', 'Interior central', 'Oeste', 'Nordeste', 'Sul'],
    [{ name: 'Indústria', share: 38 }, { name: 'Serviços', share: 48 }, { name: 'Agro e recursos', share: 14 }],
    ['Carvão', 'Terras raras', 'Capacidade industrial', 'Agricultura'],
    ['Ásia', 'Europa', 'Américas', 'África'],
  ),
  'usa-2026': modern(
    [{ name: 'População urbana', share: 83 }, { name: 'População rural', share: 17 }],
    [{ name: 'Cristianismos', share: 62 }, { name: 'Sem religião / outras', share: 38 }],
    ['Nordeste', 'Sul', 'Centro-Oeste', 'Oeste'],
    [{ name: 'Serviços e tecnologia', share: 69 }, { name: 'Indústria', share: 20 }, { name: 'Agro e recursos', share: 11 }],
    ['Petróleo e gás', 'Agricultura', 'Tecnologia', 'Minérios'],
    ['Américas', 'Ásia-Pacífico', 'Europa'],
  ),
  'portugal-1500': earlyModern(
    [{ name: 'Camponeses e trabalhadores rurais', share: 72 }, { name: 'Artesãos e mercadores', share: 18 }, { name: 'Clero e nobreza', share: 10 }],
    [{ name: 'Cristianismo latino', share: 97 }, { name: 'Outras comunidades', share: 3 }],
    ['Entre-Douro-e-Minho', 'Beiras', 'Estremadura', 'Alentejo', 'Algarve'],
    [{ name: 'Agricultura', share: 61 }, { name: 'Ofícios e manufaturas', share: 17 }, { name: 'Comércio e mar', share: 22 }],
    ['Sal', 'Madeira', 'Pescado', 'Produção agrícola'],
    ['Atlântico', 'Mediterrâneo', 'Costa africana'],
  ),
  'castile-1500': earlyModern(
    [{ name: 'Camponeses', share: 76 }, { name: 'Artesãos e mercadores', share: 14 }, { name: 'Clero e nobreza', share: 10 }],
    [{ name: 'Cristianismo latino', share: 96 }, { name: 'Outras comunidades', share: 4 }],
    ['Castela Velha', 'Castela Nova', 'Andaluzia', 'Galiza e áreas associadas'],
    [{ name: 'Agricultura e pecuária', share: 68 }, { name: 'Ofícios', share: 18 }, { name: 'Comércio', share: 14 }],
    ['Lã', 'Cereais', 'Metais', 'Pecuária'],
    ['Península Ibérica', 'Mediterrâneo', 'Atlântico'],
  ),
  'ottoman-1500': earlyModern(
    [{ name: 'Camponeses e comunidades rurais', share: 70 }, { name: 'Artesãos e comerciantes', share: 20 }, { name: 'Elites militares e administrativas', share: 10 }],
    [{ name: 'Islamismo', share: 58 }, { name: 'Cristianismos e outras comunidades', share: 42 }],
    ['Anatólia', 'Bálcãs', 'Trácia', 'Egeu'],
    [{ name: 'Agricultura', share: 58 }, { name: 'Ofícios urbanos', share: 22 }, { name: 'Comércio e tributos', share: 20 }],
    ['Cereais', 'Metais', 'Madeira', 'Rotas comerciais'],
    ['Mediterrâneo', 'Bálcãs', 'Mar Negro', 'Anatólia'],
  ),
  'ming-1500': earlyModern(
    [{ name: 'Camponeses', share: 78 }, { name: 'Artesãos e comerciantes', share: 17 }, { name: 'Letrados e elites', share: 5 }],
    [{ name: 'Tradições chinesas', share: 91 }, { name: 'Outras comunidades', share: 9 }],
    ['Norte', 'Vale do Yangtzé', 'Sudeste costeiro', 'Sul', 'Sudoeste'],
    [{ name: 'Agricultura', share: 62 }, { name: 'Manufaturas', share: 24 }, { name: 'Comércio', share: 14 }],
    ['Arroz', 'Seda', 'Porcelana', 'Metais', 'Sal'],
    ['Mercado interno', 'Sudeste Asiático', 'Índico'],
  ),
  'venice-1500': earlyModern(
    [{ name: 'Artesãos, marinheiros e trabalhadores', share: 58 }, { name: 'Mercadores e cidadãos', share: 29 }, { name: 'Patriciado e clero', share: 13 }],
    [{ name: 'Cristianismo latino', share: 94 }, { name: 'Outras comunidades', share: 6 }],
    ['Veneza', 'Terraferma', 'Possessões adriáticas e egeias'],
    [{ name: 'Comércio marítimo', share: 38 }, { name: 'Ofícios e manufaturas', share: 34 }, { name: 'Agricultura e territórios', share: 28 }],
    ['Vidro', 'Construção naval', 'Sal', 'Redes mercantis'],
    ['Mediterrâneo oriental', 'Adriático', 'Europa central'],
  ),
};

export function profileFor(entityId: string): EntityProfile | undefined {
  return entityProfiles[entityId];
}
