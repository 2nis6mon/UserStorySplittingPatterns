const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ─── Static files ───
app.use(express.static(path.join(__dirname)));
app.use('/live', express.static(path.join(__dirname, 'live')));
app.get('/live/join/:code', (req, res) => res.sendFile(path.join(__dirname, 'live', 'join.html')));
app.get('/live/trainer', (req, res) => res.sendFile(path.join(__dirname, 'live', 'trainer.html')));

// ─── QR code endpoint ───
app.get('/api/qr/:code', async (req, res) => {
  const host = getLocalIP();
  const port = PORT;
  const url = `http://${host}:${port}/live/join/${req.params.code}`;
  try {
    const qr = await QRCode.toDataURL(url, { width: 220, margin: 1 });
    res.json({ qr, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Game data ───

const VF_STATEMENTS = [
  { id: 0, text: "Une User Story peut s'étaler sur plusieurs sprints si l'équipe est d'accord.", isTrue: false, explanation: "Une story doit tenir en un seul sprint — critère S d'INVEST (Small). Si elle dépasse, c'est le signal qu'elle doit être découpée." },
  { id: 1, text: "Dans INVEST, le « S » de Small signifie que la story doit tenir en un seul sprint.", isTrue: true, explanation: "S = Small : la story doit être assez petite pour être complétée dans un seul sprint. C'est un critère non négociable." },
  { id: 2, text: "Découper par couche technique (front / back / BDD) produit des tranches verticales de valeur.", isTrue: false, explanation: "Faux ! Découper par couche = tranches horizontales. Une tranche verticale traverse toutes les couches et livre de la valeur à l'utilisateur." },
  { id: 3, text: "Une story sans critères d'acceptation peut quand même être considérée comme « Prête » (Ready).", isTrue: false, explanation: "Sans critères d'acceptation, une story n'est pas prête. Ils définissent ce que 'Done' signifie et permettent de tester la livraison." },
  { id: 4, text: "L'équipe de développement peut et doit proposer de découper une story qu'elle juge trop grosse.", isTrue: true, explanation: "Le découpage est une responsabilité partagée. L'équipe de dev a une vue technique précieuse pour identifier les bons points de découpe." },
  { id: 5, text: "Le Pattern Spike produit du code livrable en production à la fin du sprint.", isTrue: false, explanation: "Un Spike = investigation. Son résultat est de la connaissance, pas du code livrable en prod. Il aide à estimer et choisir une approche." }
];

const TRIAGE_ITEMS = [
  { id: 'A', text: "Cette semaine, l'équipe implémente la couche base de données du module de commandes (schémas, migrations, requêtes).", isVertical: false, explanation: "❌ Horizontale — Couche technique pure. Aucune valeur livrable pour l'utilisateur. Le résultat est un composant qui attend les autres couches." },
  { id: 'B', text: "En tant que client, je veux ajouter un produit alimentaire à mon panier afin de préparer mes courses en ligne.", isVertical: true, explanation: "✅ Verticale — Traverse toutes les couches (UI + métier + données). Un client peut réellement agir : valeur livrable, feedback possible." },
  { id: 'C', text: "L'équipe front développe le formulaire de paiement (design, composants React). Le back-end de paiement est prévu pour le sprint prochain.", isVertical: false, explanation: "❌ Horizontale — UI isolée sans back-end. L'utilisateur ne peut rien faire avec ce formulaire tant que le back-end n'est pas livré." }
];

const QUIZ_QUESTIONS = [
  { id: 1, scenario: "En tant que client, je veux effectuer un retour de commande afin d'être remboursé des articles non conformes.", context: null, options: [{ id: 'A', text: 'Pattern 2 — Opérations CRUD' }, { id: 'B', text: 'Pattern 1 — Étapes du Workflow' }, { id: 'C', text: 'Pattern 3 — Règles Métier' }, { id: 'D', text: 'Pattern 5 — Variations d\'Interface' }], correct: 'B', explanation: 'Pattern 1 — Workflow. Un retour suit des étapes séquentielles : déclarer → mode → déposer → valider → rembourser. Chaque étape livrable indépendamment.' },
  { id: 2, scenario: "En tant qu'employé back-office, je veux administrer le catalogue produits afin que les informations soient à jour en magasin.", context: null, options: [{ id: 'A', text: 'Pattern 2 — Opérations CRUD' }, { id: 'B', text: 'Pattern 1 — Étapes du Workflow' }, { id: 'C', text: 'Pattern 4 — Variations de Données' }, { id: 'D', text: 'Pattern 7 — Effort Concentré' }], correct: 'A', explanation: 'Pattern 2 — CRUD. "Administrer" est un signal CRUD : Créer / Modifier / Désactiver / Archiver. Chaque opération = une story indépendante.' },
  { id: 3, scenario: "En tant que client professionnel, je veux bénéficier d'un tarif adapté à ma situation afin de maîtriser mon budget.", context: "Contexte : tarif standard · tarif volume · tarif grand compte · tarif fidélité", options: [{ id: 'A', text: 'Pattern 6 — Simple / Complexe' }, { id: 'B', text: 'Pattern 7 — Effort Concentré' }, { id: 'C', text: 'Pattern 3 — Règles Métier' }, { id: 'D', text: 'Pattern 2 — Opérations CRUD' }], correct: 'C', explanation: 'Pattern 3 — Règles Métier. Chaque règle tarifaire est une variation métier distincte. Elles peuvent être livrées séparément.' },
  { id: 4, scenario: "En tant que directeur de magasin, je veux consulter les ventes afin d'analyser les performances.", context: "Contexte : par rayon · par marque · par période · par magasin · comparaison N-1", options: [{ id: 'A', text: 'Pattern 8 — Différer la Performance' }, { id: 'B', text: 'Pattern 4 — Variations de Données' }, { id: 'C', text: 'Pattern 1 — Étapes du Workflow' }, { id: 'D', text: 'Pattern 3 — Règles Métier' }], correct: 'B', explanation: 'Pattern 4 — Variations de Données. Complexité = types de données. Commencer par un type (rayon), enrichir progressivement.' },
  { id: 5, scenario: "En tant que préparateur, je veux accéder à ma liste de picking afin de préparer les commandes click & collect.", context: "Contexte : tablette entrepôt · scanner code-barres · poste fixe · application mobile", options: [{ id: 'A', text: 'Pattern 2 — Opérations CRUD' }, { id: 'B', text: 'Pattern 4 — Variations de Données' }, { id: 'C', text: 'Pattern 7 — Effort Concentré' }, { id: 'D', text: 'Pattern 5 — Variations d\'Interface' }], correct: 'D', explanation: 'Pattern 5 — Interface. La même fonctionnalité sur 4 interfaces différentes. Chaque canal = incrément indépendant.' },
  { id: 6, scenario: "En tant que client, je veux recevoir des suggestions de remplacement pour les produits indisponibles.", context: "Contexte : même rayon → produits les plus achetés → IA prédictive basée sur l'historique", options: [{ id: 'A', text: 'Pattern 6 — Simple / Complexe' }, { id: 'B', text: 'Pattern 9 — Spike d\'Investigation' }, { id: 'C', text: 'Pattern 4 — Variations de Données' }, { id: 'D', text: 'Pattern 3 — Règles Métier' }], correct: 'A', explanation: 'Pattern 6 — Simple / Complexe. Version utile d\'abord (même rayon), enrichissement progressif (+ achetés, puis IA). Sophistication croissante.' },
  { id: 7, scenario: "En tant que responsable achats, je veux passer commande chez nos fournisseurs via API REST, EDI et formulaire web.", context: null, options: [{ id: 'A', text: 'Pattern 5 — Variations d\'Interface' }, { id: 'B', text: 'Pattern 3 — Règles Métier' }, { id: 'C', text: 'Pattern 7 — Effort Concentré' }, { id: 'D', text: 'Pattern 1 — Étapes du Workflow' }], correct: 'C', explanation: 'Pattern 7 — Effort Concentré. Le premier canal (API REST) pose l\'infrastructure. Les suivants (EDI, formulaire) réutilisent et coûtent moins.' },
  { id: 8, scenario: "En tant que responsable e-commerce, je veux que le tableau de bord de ventes s'affiche en moins de 2 secondes.", context: null, options: [{ id: 'A', text: 'Pattern 3 — Règles Métier' }, { id: 'B', text: 'Pattern 6 — Simple / Complexe' }, { id: 'C', text: 'Pattern 1 — Étapes du Workflow' }, { id: 'D', text: 'Pattern 8 — Différer la Performance' }], correct: 'D', explanation: 'Pattern 8 — Différer la Performance. Séparer "ça fonctionne" de "ça fonctionne vite". Valider la logique d\'abord, optimiser ensuite avec de vraies données.' },
  { id: 9, scenario: "En tant que client, je veux scanner un produit avec mon smartphone pour obtenir des informations via IA de reconnaissance visuelle.", context: null, options: [{ id: 'A', text: 'Pattern 6 — Simple / Complexe' }, { id: 'B', text: 'Pattern 9 — Spike d\'Investigation' }, { id: 'C', text: 'Pattern 4 — Variations de Données' }, { id: 'D', text: 'Pattern 7 — Effort Concentré' }], correct: 'B', explanation: 'Pattern 9 — Spike. Faisabilité de l\'IA inconnue. Faire un spike time-boxé pour évaluer les solutions avant de s\'engager.' }
];

const MATCHING_PAIRS = [
  { id: 1, left: '🔄 Étapes du Workflow', right: 'Retour commande : déclarer → choisir mode → déposer → rembourser' },
  { id: 2, left: '⚙️ Opérations CRUD', right: '"Gérer le panier" = Ajouter + Modifier + Supprimer + Vider' },
  { id: 3, left: '📋 Règles Métier', right: 'Promotions : code promo · catalogue auto · fidélité · 2+1 offert' },
  { id: 4, left: '🗃️ Variations de Données', right: 'Recherche produits : Alimentaire → Frais → Non-alim → Boissons' },
  { id: 5, left: '📱 Variations d\'Interface', right: 'Liste picking : Tablette · Scanner · Poste fixe · Mobile' },
  { id: 6, left: '🎯 Simple / Complexe', right: 'Suggestions : même rayon → + achetés → IA prédictive' },
  { id: 7, left: '💪 Effort Concentré', right: 'Paiement : Carte bancaire (infra) → Apple Pay → Google Pay' },
  { id: 8, left: '⚡ Différer la Performance', right: 'Tableau de bord : fonctionnel → < 2s → temps réel' },
  { id: 9, left: '🔬 Spike d\'Investigation', right: 'Scanner IA : évaluer la faisabilité avant d\'implémenter' }
];

const SLIDE_MANIFEST = [
  { type: 'content', title: 'User Story Splitting Patterns' },
  { type: 'vf-activity', title: '🔗 C1 — Vrai ou Faux debout' },
  { type: 'content', title: 'Partie 1 — Pourquoi découper ?' },
  { type: 'content', title: 'Le problème des équipes agiles' },
  { type: 'content', title: 'Partie 2 — Qu\'est-ce qu\'une bonne User Story ?' },
  { type: 'content', title: 'Les critères INVEST' },
  { type: 'content', title: 'Tranches verticales vs Tranches de valeur' },
  { type: 'triage-activity', title: '✂️ C3 — Triage : Verticale ou Horizontale ?' },
  { type: 'content', title: 'Partie 3 — L\'Organigramme de Découpage' },
  { type: 'content', title: 'Vue d\'ensemble — Les 9 patterns' },
  { type: 'content', title: 'Méta-Pattern : la logique commune' },
  { type: 'content', title: 'Pattern 1 — Étapes du Workflow' },
  { type: 'content', title: 'Pattern 2 — Opérations CRUD' },
  { type: 'content', title: 'Pattern 3 — Règles Métier' },
  { type: 'content', title: 'Pattern 4 — Variations de Données' },
  { type: 'content', title: 'Pattern 5 — Variations d\'Interface' },
  { type: 'atelier-activity', title: '🛠️ C3 — Atelier mi-parcours' },
  { type: 'content', title: 'Pattern 6 — Simple / Complexe' },
  { type: 'content', title: 'Pattern 7 — Effort Concentré' },
  { type: 'content', title: 'Pattern 8 — Différer la Performance' },
  { type: 'content', title: 'Pattern 9 — Spike d\'Investigation' },
  { type: 'content', title: 'Partie 4 — S\'améliorer dans le découpage' },
  { type: 'content', title: 'La méthode en 2-3 semaines' },
  { type: 'content', title: 'Récapitulatif — Les 9 Patterns' },
  { type: 'content', title: 'Partie 5 — Quiz' },
  { type: 'quiz-activity', title: 'Q1/9 — Retour de commande', qId: 1 },
  { type: 'quiz-activity', title: 'Q2/9 — Catalogue produits', qId: 2 },
  { type: 'quiz-activity', title: 'Q3/9 — Tarif adapté', qId: 3 },
  { type: 'quiz-activity', title: 'Q4/9 — Consulter les ventes', qId: 4 },
  { type: 'quiz-activity', title: 'Q5/9 — Liste de picking', qId: 5 },
  { type: 'quiz-activity', title: 'Q6/9 — Suggestions remplacement', qId: 6 },
  { type: 'quiz-activity', title: 'Q7/9 — Commander via API/EDI', qId: 7 },
  { type: 'quiz-activity', title: 'Q8/9 — Tableau de bord < 2s', qId: 8 },
  { type: 'quiz-activity', title: 'Q9/9 — Scanner produit IA', qId: 9 },
  { type: 'results', title: 'Résultats du Quiz' },
  { type: 'c4-activity', title: '🎯 C4 — Votre plan de match' }
];

// ─── Session management ───

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function createSession(trainerId, trainerToken) {
  return {
    trainerId,
    trainerToken,
    currentSlide: 0,
    participants: new Map(),
    vf: { currentIndex: -1, votes: {}, revealed: new Set() },
    triage: { currentIndex: -1, votes: {}, revealed: new Set() },
    quiz: { answers: {}, revealed: new Set() },
    matching: { active: false, submissions: {} },
    c4: { responses: {} },
    timer: null
  };
}

const sessions = new Map();

function participantList(session) {
  const list = [];
  session.participants.forEach((p, id) => list.push({ id, name: p.name, score: p.score, connected: p.connected }));
  return list;
}

function vfVotes(session, idx) {
  const v = session.vf.votes[idx] || { vrai: new Set(), faux: new Set() };
  return { vrai: v.vrai.size, faux: v.faux.size, total: session.participants.size };
}

function triageVotes(session, itemId) {
  const v = session.triage.votes[itemId] || { vertical: new Set(), horizontal: new Set() };
  return { vertical: v.vertical.size, horizontal: v.horizontal.size, total: session.participants.size };
}

function quizVotes(session, qId) {
  const v = session.quiz.answers[qId] || { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
  return { A: v.A.size, B: v.B.size, C: v.C.size, D: v.D.size, total: session.participants.size };
}

// ─── Socket.io ───

io.on('connection', (socket) => {

  socket.on('create-session', (callback) => {
    let code;
    do { code = genCode(5); } while (sessions.has(code));
    const token = genCode(8);
    sessions.set(code, createSession(socket.id, token));
    socket.join(code);
    socket.roomCode = code;
    socket.role = 'trainer';
    callback({ success: true, roomCode: code, trainerToken: token });
  });

  socket.on('claim-trainer', ({ roomCode, trainerToken }, callback) => {
    const code = roomCode.toUpperCase();
    const session = sessions.get(code);
    if (!session || session.trainerToken !== trainerToken) {
      callback({ success: false, error: 'Token invalide' });
      return;
    }
    session.trainerId = socket.id;
    socket.join(code);
    socket.roomCode = code;
    socket.role = 'trainer';
    callback({
      success: true,
      currentSlide: session.currentSlide,
      slideInfo: SLIDE_MANIFEST[session.currentSlide],
      participants: participantList(session),
      totalSlides: SLIDE_MANIFEST.length
    });
  });

  socket.on('join-session', ({ roomCode, name }, callback) => {
    const code = roomCode.trim().toUpperCase();
    const session = sessions.get(code);
    if (!session) { callback({ success: false, error: 'Code de session introuvable. Vérifiez le code avec votre formateur.' }); return; }

    socket.join(code);
    socket.roomCode = code;
    socket.role = 'participant';
    socket.participantName = name;

    session.participants.set(socket.id, { name, score: 0, quizAnswers: {}, vfAnswers: {}, triageAnswers: {}, c4Answers: {}, connected: true });

    const slideInfo = SLIDE_MANIFEST[session.currentSlide];
    const extra = buildSlideExtra(session, slideInfo);
    callback({ success: true, currentSlide: session.currentSlide, slideInfo, totalSlides: SLIDE_MANIFEST.length, extra });

    io.to(session.trainerId).emit('participant-joined', { name, count: session.participants.size, participants: participantList(session) });
  });

  // ── Slide navigation (trainer) ──
  socket.on('trainer-navigate', (dir) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    const next = Math.max(0, Math.min(SLIDE_MANIFEST.length - 1, session.currentSlide + dir));
    if (next === session.currentSlide) return;
    session.currentSlide = next;
    const slideInfo = SLIDE_MANIFEST[next];
    const extra = buildSlideExtra(session, slideInfo);
    io.to(socket.roomCode).emit('slide-changed', { slide: next, slideInfo, extra });
  });

  socket.on('trainer-goto', (idx) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    if (idx < 0 || idx >= SLIDE_MANIFEST.length) return;
    session.currentSlide = idx;
    const slideInfo = SLIDE_MANIFEST[idx];
    const extra = buildSlideExtra(session, slideInfo);
    io.to(socket.roomCode).emit('slide-changed', { slide: idx, slideInfo, extra });
  });

  // ── VF ──
  socket.on('vf-show-statement', (idx) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    const stmt = VF_STATEMENTS[idx];
    if (!stmt) return;
    session.vf.currentIndex = idx;
    if (!session.vf.votes[idx]) session.vf.votes[idx] = { vrai: new Set(), faux: new Set() };
    io.to(socket.roomCode).emit('vf-statement', { index: idx, text: stmt.text, total: VF_STATEMENTS.length });
  });

  socket.on('vf-vote', ({ index, answer }) => {
    const session = sessions.get(socket.roomCode);
    if (!session || socket.role !== 'participant') return;
    const p = session.participants.get(socket.id);
    if (!p || p.vfAnswers[index] !== undefined) return;
    p.vfAnswers[index] = answer;
    if (!session.vf.votes[index]) session.vf.votes[index] = { vrai: new Set(), faux: new Set() };
    session.vf.votes[index][answer === 'vrai' ? 'vrai' : 'faux'].add(socket.id);
    io.to(session.trainerId).emit('vf-votes-updated', { index, ...vfVotes(session, index) });
    socket.emit('vf-vote-confirmed', { index, answer });
  });

  socket.on('vf-reveal', (idx) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    const stmt = VF_STATEMENTS[idx];
    if (!stmt) return;
    session.vf.revealed.add(idx);
    io.to(socket.roomCode).emit('vf-revealed', { index: idx, isTrue: stmt.isTrue, explanation: stmt.explanation, ...vfVotes(session, idx) });
  });

  // ── Triage ──
  socket.on('triage-show-item', (idx) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    const item = TRIAGE_ITEMS[idx];
    if (!item) return;
    session.triage.currentIndex = idx;
    if (!session.triage.votes[item.id]) session.triage.votes[item.id] = { vertical: new Set(), horizontal: new Set() };
    io.to(socket.roomCode).emit('triage-item', { index: idx, id: item.id, text: item.text, total: TRIAGE_ITEMS.length });
  });

  socket.on('triage-vote', ({ itemId, answer }) => {
    const session = sessions.get(socket.roomCode);
    if (!session || socket.role !== 'participant') return;
    const p = session.participants.get(socket.id);
    if (!p || p.triageAnswers[itemId] !== undefined) return;
    p.triageAnswers[itemId] = answer;
    if (!session.triage.votes[itemId]) session.triage.votes[itemId] = { vertical: new Set(), horizontal: new Set() };
    session.triage.votes[itemId][answer === 'vertical' ? 'vertical' : 'horizontal'].add(socket.id);
    io.to(session.trainerId).emit('triage-votes-updated', { itemId, ...triageVotes(session, itemId) });
    socket.emit('triage-vote-confirmed', { itemId, answer });
  });

  socket.on('triage-reveal', (idx) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    const item = TRIAGE_ITEMS[idx];
    if (!item) return;
    session.triage.revealed.add(item.id);
    io.to(socket.roomCode).emit('triage-revealed', { index: idx, id: item.id, isVertical: item.isVertical, explanation: item.explanation, ...triageVotes(session, item.id) });
  });

  // ── Quiz ──
  socket.on('quiz-answer', ({ qId, answer }) => {
    const session = sessions.get(socket.roomCode);
    if (!session || socket.role !== 'participant') return;
    const p = session.participants.get(socket.id);
    if (!p || p.quizAnswers[qId] !== undefined) return;
    p.quizAnswers[qId] = answer;
    const q = QUIZ_QUESTIONS.find(q => q.id === qId);
    const isCorrect = q && answer === q.correct;
    if (isCorrect) p.score++;
    if (!session.quiz.answers[qId]) session.quiz.answers[qId] = { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
    session.quiz.answers[qId][answer].add(socket.id);
    io.to(session.trainerId).emit('quiz-votes-updated', { qId, ...quizVotes(session, qId) });
    socket.emit('quiz-answer-confirmed', { qId, answer, isCorrect, correctAnswer: q?.correct, explanation: q?.explanation });
  });

  socket.on('quiz-reveal', (qId) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    const q = QUIZ_QUESTIONS.find(q => q.id === qId);
    if (!q) return;
    session.quiz.revealed.add(qId);
    io.to(socket.roomCode).emit('quiz-revealed', { qId, correct: q.correct, explanation: q.explanation, ...quizVotes(session, qId) });
  });

  // ── Matching ──
  socket.on('matching-start', () => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    session.matching.active = true;
    session.participants.forEach((p, pid) => {
      const left = shuffle(MATCHING_PAIRS.map(p => ({ id: p.id, text: p.left })));
      const right = shuffle(MATCHING_PAIRS.map(p => ({ id: p.id, text: p.right })));
      io.to(pid).emit('matching-start', { left, right });
    });
    socket.emit('matching-launched');
  });

  socket.on('matching-submit', (pairs) => {
    const session = sessions.get(socket.roomCode);
    if (!session || socket.role !== 'participant') return;
    session.matching.submissions[socket.id] = pairs;
    let correct = 0;
    pairs.forEach(({ leftId, rightId }) => { if (leftId === rightId) correct++; });
    socket.emit('matching-result', { pairs, correct, total: MATCHING_PAIRS.length, correctPairs: MATCHING_PAIRS });
    const p = session.participants.get(socket.id);
    io.to(session.trainerId).emit('matching-submitted', { name: p?.name || '?', correct, total: MATCHING_PAIRS.length });
  });

  // ── C4 ──
  socket.on('c4-submit', (responses) => {
    const session = sessions.get(socket.roomCode);
    if (!session || socket.role !== 'participant') return;
    const p = session.participants.get(socket.id);
    if (!p) return;
    p.c4Answers = responses;
    session.c4.responses[socket.id] = { name: p.name, ...responses };
    socket.emit('c4-submitted');
    io.to(session.trainerId).emit('c4-responses-updated', Object.values(session.c4.responses));
  });

  // ── Timer ──
  socket.on('start-timer', (seconds) => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    if (session.timer) { clearInterval(session.timer.interval); }
    let remaining = parseInt(seconds);
    io.to(socket.roomCode).emit('timer-start', { seconds: remaining });
    const interval = setInterval(() => {
      remaining--;
      io.to(socket.roomCode).emit('timer-tick', { remaining });
      if (remaining <= 0) {
        clearInterval(interval);
        session.timer = null;
        io.to(socket.roomCode).emit('timer-end');
      }
    }, 1000);
    session.timer = { interval };
  });

  socket.on('stop-timer', () => {
    const session = sessions.get(socket.roomCode);
    if (!session || session.trainerId !== socket.id) return;
    if (session.timer) { clearInterval(session.timer.interval); session.timer = null; }
    io.to(socket.roomCode).emit('timer-stopped');
  });

  socket.on('disconnect', () => {
    if (!socket.roomCode) return;
    const session = sessions.get(socket.roomCode);
    if (!session) return;
    if (socket.role === 'participant') {
      const p = session.participants.get(socket.id);
      if (p) {
        p.connected = false;
        io.to(session.trainerId).emit('participant-left', { name: p.name, count: session.participants.size, participants: participantList(session) });
      }
    }
  });
});

function buildSlideExtra(session, slideInfo) {
  if (!slideInfo) return null;
  if (slideInfo.type === 'quiz-activity') {
    const q = QUIZ_QUESTIONS.find(q => q.id === slideInfo.qId);
    return q ? { question: q } : null;
  }
  return null;
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   User Story Splitting — Live Facilitation       ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  Formateur  : http://localhost:${PORT}/live/trainer   ║`);
  console.log(`║  Réseau     : http://${ip}:${PORT}/live/trainer  ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
});
