export interface CuratedLoadingTip {
  id: string;
  text: string;
  tags: string[];
}

export const DEFAULT_FALLBACK_LOADING_TIP =
  'Quando a escala de uma maquete dobra, comprimentos dobram (×2), áreas quadruplicam (×2²) e volumes multiplicam por oito (×2³), porque cada dimensão cresce junto.';

export const CURATED_LOADING_TIPS: CuratedLoadingTip[] = [
  // Matemática (6)
  {
    id: 'curated_mat_01',
    text: 'Quando a escala de uma maquete dobra, comprimentos dobram (×2), áreas quadruplicam (×2²) e volumes multiplicam por oito (×2³), porque cada dimensão cresce junto.',
    tags: ['matemática', 'geometria', 'escala', 'razão e proporção', 'volume', 'área'],
  },
  {
    id: 'curated_mat_02',
    text: 'Subir um preço em 20% e depois baixar 20% não volta ao valor inicial: o desconto incide sobre um número maior, deixando o preço final 4% menor.',
    tags: ['matemática', 'porcentagem', 'juros', 'matemática financeira'],
  },
  {
    id: 'curated_mat_03',
    text: 'Juros simples crescem sempre sobre o valor inicial em linha reta; juros compostos incidem sobre o montante acumulado, criando aceleração exponencial a cada período.',
    tags: ['matemática', 'juros compostos', 'função exponencial', 'matemática financeira'],
  },
  {
    id: 'curated_mat_04',
    text: 'A média muda muito quando há um valor extremo, como um salário milionário na turma; a mediana fica imune a extremos porque olha apenas para a posição central.',
    tags: ['matemática', 'estatística', 'média', 'mediana', 'gráficos'],
  },
  {
    id: 'curated_mat_05',
    text: 'Calcular a probabilidade de "pelo menos um acerto" costuma ser trabalhoso; quase sempre é mais rápido subtrair de 100% a chance de errar tudo.',
    tags: ['matemática', 'probabilidade', 'análise combinatória'],
  },
  {
    id: 'curated_mat_06',
    text: 'Em grandezas inversamente proporcionais, como velocidade e tempo de viagem, dobrar uma reduz a outra à metade, mantendo o produto entre elas sempre constante.',
    tags: ['matemática', 'regra de três', 'proporcionalidade', 'funções'],
  },

  // Física (6)
  {
    id: 'curated_fis_01',
    text: 'Carros amassam a frente na batida para aumentar o tempo de parada: quanto mais tempo dura o impacto, menor é a força média que chega ao passageiro.',
    tags: ['física', 'mecânica', 'impulso', 'quantidade de movimento', 'dinâmica'],
  },
  {
    id: 'curated_fis_02',
    text: 'Potência em watts mede a rapidez com que o aparelho gasta energia, mas a conta de luz cobra kWh, que é a potência multiplicada pelo tempo de uso.',
    tags: ['física', 'eletricidade', 'potência elétrica', 'energia', 'eletrodinâmica'],
  },
  {
    id: 'curated_fis_03',
    text: 'Na ligação em paralelo, cada lâmpada recebe a tensão inteira da rede de forma independente; em série, elas dividem a tensão e apagam juntas se uma queimar.',
    tags: ['física', 'eletrodinâmica', 'circuitos elétricos', 'eletricidade'],
  },
  {
    id: 'curated_fis_04',
    text: 'A areia da praia esquenta mais rápido que o mar porque tem calor específico menor: ela precisa de pouca energia térmica para subir cada grau de temperatura.',
    tags: ['física', 'termologia', 'calorimetria', 'calor específico'],
  },
  {
    id: 'curated_fis_05',
    text: 'Quando a luz passa do ar para a água, sua velocidade e comprimento de onda diminuem, mas a frequência permanece idêntica porque depende apenas da fonte emissora.',
    tags: ['física', 'óptica', 'ondulatória', 'refração'],
  },
  {
    id: 'curated_fis_06',
    text: 'Navios de aço flutuam porque seu casco oco ocupa um volume enorme de água, tornando a densidade média do conjunto menor que a da água ao redor.',
    tags: ['física', 'hidrostática', 'empuxo', 'densidade'],
  },

  // Química (6)
  {
    id: 'curated_qui_01',
    text: 'A escala de pH é logarítmica: cair de pH 5 para pH 3 não deixa a solução apenas um pouco mais ácida, mas cem vezes mais concentrada em íons H⁺.',
    tags: ['química', 'ph', 'ácidos e bases', 'equilíbrio químico', 'soluções'],
  },
  {
    id: 'curated_qui_02',
    text: 'Um catalisador acelera a reação abrindo um atalho com menor energia de ativação, porém entra e sai intacto e não altera a energia liberada ou absorvida.',
    tags: ['química', 'cinética química', 'termoquímica', 'catalisador'],
  },
  {
    id: 'curated_qui_03',
    text: 'Água e óleo não se misturam porque moléculas polares da água se atraem fortemente entre si, empurrando as moléculas apolares do óleo para fora da rede.',
    tags: ['química', 'polaridade', 'interações intermoleculares', 'soluções', 'química orgânica'],
  },
  {
    id: 'curated_qui_04',
    text: 'Em pilhas, quem tem menor potencial de redução sofre oxidação no ânodo e perde elétrons; esses elétrons viajam pelo fio até o cátodo, que se reduz.',
    tags: ['química', 'eletroquímica', 'pilhas', 'oxirredução'],
  },
  {
    id: 'curated_qui_05',
    text: 'Ligações de hidrogênio explicam por que a água ferve a 100 °C enquanto moléculas de massa parecida viram gás bem abaixo de zero: custa mais separar suas moléculas.',
    tags: ['química', 'ligações químicas', 'forças intermoleculares', 'propriedades físicas'],
  },
  {
    id: 'curated_qui_06',
    text: 'Na estequiometria, a reação para assim que o reagente limitante acaba: calcular o produto pelo reagente em excesso superestima o rendimento porque sobra massa sem par.',
    tags: ['química', 'estequiometria', 'reações químicas'],
  },

  // Biologia (6)
  {
    id: 'curated_bio_01',
    text: 'Febre muito alta é perigosa porque rompe as ligações que mantêm o formato 3D das enzimas: sem o encaixe exato com o substrato, elas param de funcionar.',
    tags: ['biologia', 'bioquímica', 'enzimas', 'proteínas', 'fisiologia'],
  },
  {
    id: 'curated_bio_02',
    text: 'A seleção natural não cria mutações para ajudar a espécie: variantes surgem ao acaso, e o ambiente apenas favorece a sobrevivência de quem já nasceu com vantagem.',
    tags: ['biologia', 'evolução', 'seleção natural', 'genética'],
  },
  {
    id: 'curated_bio_03',
    text: 'O excesso de esgoto na lagoa mata peixes por sufocamento indireto: algas crescem demais, morrem e as bactérias decompositoras consomem todo o oxigênio dissolvido na água.',
    tags: ['biologia', 'ecologia', 'eutrofização', 'impactos ambientais'],
  },
  {
    id: 'curated_bio_04',
    text: 'Vacinas entregam antígenos enfraquecidos para ensinar o corpo a criar memória imune duradoura; soros já entregam anticorpos prontos para neutralizar venenos em emergências imediatas.',
    tags: ['biologia', 'imunologia', 'saúde', 'vacina', 'fisiologia'],
  },
  {
    id: 'curated_bio_05',
    text: 'Salgar uma salada faz as folhas murcharem porque a água sai das células por osmose tentando diluir o meio externo mais concentrado até equilibrar as pressões.',
    tags: ['biologia', 'citologia', 'membrana plasmática', 'osmose'],
  },
  {
    id: 'curated_bio_06',
    text: 'Efeito estufa retém calor na baixa atmosfera por gases como CO₂; já o buraco de ozônio na estratosfera deixa passar mais radiação UV sem causar aquecimento direto.',
    tags: ['biologia', 'ecologia', 'química ambiental', 'aquecimento global'],
  },

  // Geral / Humanas & Linguagens (6)
  {
    id: 'curated_ger_01',
    text: 'Gráficos com o eixo vertical cortado fora do zero exageram pequenas diferenças visuais: duas barras de altura dobrada podem representar uma variação real de apenas 5%.',
    tags: ['geral', 'linguagens', 'matemática', 'interpretação de gráficos', 'estatística'],
  },
  {
    id: 'curated_ger_02',
    text: 'Quando dois eventos sobem juntos num gráfico, um não causou necessariamente o outro: ambos podem responder a uma terceira variável oculta, como clima ou renda.',
    tags: ['geral', 'ciências humanas', 'estatística', 'interpretação de texto'],
  },
  {
    id: 'curated_ger_03',
    text: 'População absoluta indica quantas pessoas vivem no país; densidade demográfica divide esse total pela área, revelando se o território é realmente povoado ou apenas extenso.',
    tags: ['geral', 'geografia', 'demografia', 'ciências humanas'],
  },
  {
    id: 'curated_ger_04',
    text: 'Textos antigos cobrados no ENEM devem ser lidos pelo contexto da época do autor: julgar valores passados com critérios de hoje distorce o sentido original da fonte.',
    tags: ['geral', 'história', 'ciências humanas', 'linguagens'],
  },
  {
    id: 'curated_ger_05',
    text: 'Na interpretação de charges e tirinhas, o humor ou a crítica nasce do contraste entre o que está escrito e o detalhe visual desenhado na cena.',
    tags: ['geral', 'linguagens', 'interpretação de texto', 'gêneros textuais'],
  },
  {
    id: 'curated_ger_06',
    text: 'Na variação linguística, formas regionais ou coloquiais não são erros de lógica: elas seguem regras próprias de cada comunidade e se tornam inadequadas apenas fora de contexto.',
    tags: ['geral', 'linguagens', 'variação linguística', 'português'],
  },
];
