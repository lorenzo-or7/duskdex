// #/ajuda — Perguntas frequentes: o que o DuskDex faz, o que ainda não faz e por quê.
import { html, render, normalize } from '../core/html.js';
import { icon } from '../core/icons.js';
import { setQuery } from '../router.js';

const a = (href, label) => html`<a href="${href}">${label}</a>`;

export const FAQ = [
  {
    id: 'cartas', title: 'Cartas e catálogo', icon: 'layers', items: [
      {
        id: 'sem-foto', q: 'Por que algumas cartas aparecem sem foto?',
        a: html`<p>O DuskDex não hospeda imagens de cartas: ele mostra as imagens públicas da <strong>TCGdex</strong> e, quando ela não tem, procura a mesma carta em inglês e depois na base <strong>PokemonTCG</strong>. Se nenhuma das fontes tem a imagem, aparece o cartão com o nome e a estrela.</p>
          <p>Isso acontece principalmente com:</p>
          <ul><li><strong>promos muito recentes</strong> (como as MEP Black Star Promos da Megaevolução e as últimas SVP);</li>
          <li><strong>coleções de energias</strong> (Megaevolução Energia, Escarlate e Violeta Energia);</li>
          <li>algumas cartas em <strong>japonês, coreano, chinês, indonésio e tailandês</strong>, que não têm fonte alternativa.</li></ul>
          <p>Não é preciso fazer nada: o site já aponta para o endereço certo da TCGdex, então a foto aparece sozinha assim que ela for publicada lá.</p>`,
      },
      {
        id: 'foto-propria', q: 'Posso usar uma foto minha para uma carta sem imagem?',
        a: html`<p>Ainda não dá para trocar a imagem de uma carta do catálogo. O que já existe: em <strong>Adicionar cartas → Personalizada</strong> você cria uma carta com a sua foto (ou scan). Ela funciona na coleção e nos fichários, mas fica separada da carta do catálogo — não entra na validação de decks nem na legalidade.</p>`,
      },
      {
        id: 'sem-logo', q: 'Por que algumas expansões não têm logo?',
        a: html`<p>Coleções de promos (Black Star Promos) e de energias normalmente não têm um logo oficial, e algumas expansões novas ainda não tiveram o logo publicado nas bases públicas. Nesses casos o DuskDex mostra o nome da expansão no lugar do logo.</p>`,
      },
      {
        id: 'imagem-ingles', q: 'Por que uma carta em português aparece com a imagem em inglês?',
        a: html`<p>Quando a TCGdex ainda não tem a imagem no idioma da carta, o DuskDex usa a da mesma carta em inglês para não deixar o espaço vazio. Os dados (nome, ataques, expansão) continuam no idioma escolhido.</p>`,
      },
      {
        id: 'idiomas', q: 'Quais idiomas de cartas existem no catálogo?',
        a: html`<p>Treze: português (Brasil), inglês, espanhol, espanhol (México), francês, italiano, alemão, japonês, coreano, chinês tradicional, chinês simplificado, indonésio e tailandês. Português de Portugal, holandês, polonês e russo existem na TCGdex, mas sem nenhuma carta cadastrada.</p>
          <p>O catálogo vem embutido no site: a busca é instantânea e funciona sem depender da TCGdex estar no ar. Ele é atualizado junto com as versões do DuskDex — cartas lançadas depois podem demorar um pouco a aparecer.</p>`,
      },
      {
        id: 'filtros', q: 'O filtro de GX, ex, V… deixou passar uma carta. Por quê?',
        a: html`<p>As bases públicas não têm um campo “GX” ou “V”: essa informação faz parte do nome da carta, e cada idioma escreve de um jeito (V-ASTRO / VSTAR, TURBO / BREAK…). O DuskDex reconhece os padrões conhecidos, mas uma carta com nome fora do padrão pode escapar. As raridades (Ilustração Rara, Rara Dupla…) vêm de um campo próprio e são confiáveis.</p>`,
      },
      {
        id: 'estado', q: 'O que significam M, NM, SP, MP, HP, D e HD?',
        a: html`<p>São os estados de conservação da carta física, do melhor ao pior:</p>
          <ul><li><strong>M — Mint</strong>: perfeita, como saiu do pacote.</li>
          <li><strong>NM — Near Mint</strong>: marcas mínimas, só vistas de perto.</li>
          <li><strong>SP — Slightly Played</strong>: pequenos desgastes nas bordas ou cantos.</li>
          <li><strong>MP — Moderately Played</strong>: desgaste visível, arranhões leves.</li>
          <li><strong>HP — Heavily Played</strong>: desgaste forte, vincos leves.</li>
          <li><strong>D — Damaged</strong>: dobras, pequenos rasgos ou manchas.</li>
          <li><strong>HD — Hard Damaged</strong>: danos graves, como rasgos, água ou recortes.</li></ul>
          <p>Você escolhe o estado ao adicionar a carta e pode mudar depois na página da carta, em “Na sua coleção”. Nas <strong>trocas</strong>, cada carta oferecida mostra o estado informado pelo dono; se o estado mudar depois da proposta, a troca não pode ser aceita até uma nova proposta ser feita.</p>`,
      },
      {
        id: 'legalidade', q: 'A indicação de legalidade (Standard/Expanded) é oficial?',
        a: html`<p>Não. Ela segue a lista pública da TCGdex e serve como guia. Antes de um torneio, confira o anúncio oficial de rotação e de cartas banidas.</p>`,
      },
    ],
  },
  {
    id: 'ainda-nao', title: 'O que o DuskDex ainda não faz', icon: 'info', items: [
      { id: 'precos', q: 'Mostra preço das cartas ou o valor da coleção?', a: html`<p>Não. O DuskDex organiza a coleção (quantas cópias, onde estão e em que estado de conservação) e ajuda nas trocas, mas não mostra preços de mercado.</p>` },
      { id: 'scanner', q: 'Dá para escanear a carta com a câmera?', a: html`<p>Ainda não. As cartas são adicionadas pela busca no catálogo (por nome, número, expansão ou filtros).</p>` },
      { id: 'importar-planilha', q: 'Posso importar minha coleção de uma planilha ou de outro aplicativo?', a: html`<p>Ainda não há importação de planilhas (CSV) ou de outros aplicativos. O que existe é a <strong>exportação</strong> em JSON (${a('#/configuracoes?secao=dados', 'Configurações → Dados')}) e a importação da coleção usada sem conta para a sua conta.</p>` },
      { id: 'mensagens', q: 'Existe chat ou mensagem direta entre colecionadores?', a: html`<p>Não há chat. Dá para comentar publicações na comunidade e escrever uma mensagem ao propor, aceitar ou recusar uma troca.</p>` },
      { id: 'avisos-email', q: 'Recebo avisos por e-mail ou no celular?', a: html`<p>Não. Curtidas, comentários, seguidores e trocas aparecem só em ${a('#/notificacoes', 'Notificações')}, dentro do site. Os únicos e-mails enviados são o de confirmação de cadastro e o de redefinição de senha.</p>` },
      { id: 'offline', q: 'Funciona sem internet ou como aplicativo instalado?', a: html`<p>Não como aplicativo. A busca no catálogo funciona mesmo com a TCGdex fora do ar, mas o site precisa estar aberto no navegador, e as fotos das cartas vêm da internet.</p>` },
      { id: 'idioma-site', q: 'O site está disponível em outros idiomas?', a: html`<p>Por enquanto a interface é só em português. O catálogo de cartas, sim, tem vários idiomas (veja acima).</p>` },
    ],
  },
  {
    id: 'conta', title: 'Conta e dados', icon: 'user', items: [
      {
        id: 'sem-conta', q: 'Qual a diferença entre usar com conta e sem conta?',
        a: html`<p><strong>Sem conta</strong>, tudo fica guardado só neste navegador, neste aparelho: não aparece em outro computador, e limpar os dados do navegador apaga a coleção. Não há comunidade nem trocas.</p>
          <p><strong>Com conta</strong>, a coleção fica no servidor e você acessa de qualquer lugar, além de participar da comunidade e das trocas. Ao criar a conta, o DuskDex oferece trazer a coleção que estava no navegador.</p>`,
      },
      {
        id: 'email', q: 'Não recebi o e-mail de confirmação. E agora?',
        a: html`<p>Confira a caixa de spam e as abas “Promoções”/“Atualizações”. Dá para pedir um link novo em ${a('#/configuracoes?secao=conta', 'Configurações → Conta')} (ele vale por 48 horas). Se o site estiver rodando no seu próprio computador em modo de teste, o aviso “Confirme seu e-mail” mostra o botão <strong>Confirmar agora</strong>.</p>`,
      },
      { id: 'senha', q: 'Esqueci minha senha.', a: html`<p>Use ${a('#/recuperar', 'Recuperar senha')} na tela de entrada. O link chega por e-mail, vale por 1 hora e só funciona uma vez.</p>` },
      { id: 'backup', q: 'Como faço backup ou levo meus dados embora?', a: html`<p>Em ${a('#/configuracoes?secao=dados', 'Configurações → Dados')} há a exportação em JSON (coleção, fichários, decks, wishlist e histórico). As imagens que você enviou não vão no arquivo.</p>` },
      { id: 'excluir', q: 'Como excluo minha conta?', a: html`<p>Em ${a('#/configuracoes?secao=conta', 'Configurações → Conta')}, com a sua senha. A exclusão apaga a coleção, os fichários, as imagens e as publicações e não pode ser desfeita — exporte os dados antes, se quiser guardar.</p>` },
      { id: 'privacidade', q: 'O que os outros colecionadores veem de mim?', a: html`<p>Só o que você deixar público: perfil, fichários e decks marcados como públicos. E-mail, localização física das cartas e o inventário nunca aparecem. Fotos enviadas têm os dados de localização (GPS) removidos.</p>` },
    ],
  },
  {
    id: 'trocas', title: 'Comunidade e trocas', icon: 'repeat', items: [
      { id: 'como-troca', q: 'O DuskDex cuida do envio ou do pagamento das trocas?', a: html`<p>Não. O site registra a troca e atualiza as duas coleções quando ela é aceita; o envio ou a entrega são combinados diretamente entre vocês. Prefira locais públicos e confira as cartas antes de aceitar.</p>` },
      { id: 'carta-indisponivel', q: 'Por que uma carta da troca aparece como “indisponível”?', a: html`<p>Ela mudou depois da proposta: foi removida da coleção, montada num deck ou já trocada com outra pessoa. Uma troca com carta indisponível não pode ser aceita — proponha de novo.</p>` },
      { id: 'denunciar', q: 'Como denuncio uma publicação ou um perfil?', a: html`<p>Use “Denunciar” no menu da publicação, do comentário ou do perfil. Também dá para bloquear alguém: vocês deixam de ver as publicações um do outro e as trocas pendentes são canceladas.</p>` },
    ],
  },
];

export default async function faqPage(ctx, main) {
  const st = { q: '', open: ctx.query.item || '' };
  render(main, html`<div class="page faq" style="max-width:860px">
    <div class="page-head"><div><div class="page-head__eyebrow">Ajuda</div><h1>Perguntas frequentes</h1>
      <p>Como o DuskDex funciona, o que ele ainda não faz e por que algumas cartas aparecem sem foto.</p></div></div>
    <div class="input-group faq__search">${icon('search')}<input class="input" type="search" placeholder="Buscar nas perguntas (ex.: foto, senha, troca)" data-q aria-label="Buscar nas perguntas"></div>
    <div data-faq></div>
    <p class="faq__more text-sm muted">O DuskDex é um projeto independente de fãs, sem afiliação com Nintendo, Creatures, GAME FREAK ou The Pokémon Company. Dados e imagens de cartas: ${a('https://tcgdex.dev/', 'TCGdex')} e PokemonTCG.</p>
  </div>`);
  const box = main.querySelector('[data-faq]');
  const paint = () => {
    const n = normalize(st.q);
    const text = (it) => `${it.q} ${String(it.a).replace(/<[^>]+>/g, ' ')}`;
    const match = (it) => !n || normalize(text(it)).includes(n);
    const sections = FAQ.map((s) => ({ ...s, items: s.items.filter(match) })).filter((s) => s.items.length);
    render(box, sections.length ? html`${sections.map((s) => html`<section class="faq__section" id="faq-${s.id}">
        <h2 class="faq__title">${icon(s.icon)} ${s.title}</h2>
        ${s.items.map((it) => html`<details class="faq__item" id="faq-${it.id}" data-item="${it.id}" ${st.open === it.id || (n && s.items.length <= 3) ? 'open' : ''}>
          <summary>${it.q}${icon('chevronDown')}</summary><div class="faq__answer">${it.a}</div></details>`)}
      </section>`)}` : html`<div class="state"><div class="state__icon">${icon('search')}</div><h3>Nada encontrado</h3><p>Tente outra palavra.</p></div>`);
    box.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => {
      if (d.open) { st.open = d.dataset.item; setQuery({ item: st.open }); }
    }));
  };
  const q = main.querySelector('[data-q]');
  q.addEventListener('input', () => { st.q = q.value.trim(); paint(); });
  paint();
  if (st.open) main.querySelector(`#faq-${CSS.escape(st.open)}`)?.scrollIntoView({ block: 'center' });
}
