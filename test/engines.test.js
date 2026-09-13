// Engine verification: real nspell + dictionary-en, no mocks for the checker itself.
// Run: npm test
const fs = require('fs');
const path = require('path');
const nspell = require('nspell');

const root = path.join(__dirname, '..');
const dictDir = path.join(root, 'node_modules', 'dictionary-en');
const spell = nspell(
  fs.readFileSync(path.join(dictDir, 'index.aff'), 'utf8'),
  fs.readFileSync(path.join(dictDir, 'index.dic'), 'utf8')
);

const { createSpelling } = require('../src/spelling');
const { activeTokenSpan } = require('../src/tokens');
const { checkGrammar, normalizeErrors, currentSentenceRange } = require('../src/grammar');

const api = createSpelling(spell, { isCustom: () => false, isIgnored: () => false });

function analyze(sentence) {
  const sp = api.checkSpelling(sentence);
  const gr = checkGrammar(sentence, api.knownWord);
  for (const e of [...sp, ...gr]) { /* offsets already absolute (whole-sentence input) */ }
  return normalizeErrors(sp, gr);
}

let failures = 0;
function expect(sentence, want) {
  // want: array of "type:original->firstSuggestion" (firstSuggestion optional, '' = none asserted)
  const got = analyze(sentence).map((e) => `${e.type}:${e.originalText}->${e.suggestions[0] || ''}`);
  const ok = want.length === got.length && want.every((w, i) => {
    const [wt, rest] = w.split(':');
    const [wo, ws] = rest.split('->');
    const [gt, grest] = got[i].split(':');
    const [go, gs] = grest.split('->');
    if (wt !== gt || wo !== go) return false;
    if (ws !== undefined && ws !== '' && ws !== gs) return false;
    return true;
  });
  console.log((ok ? 'PASS' : 'FAIL'), JSON.stringify(sentence), '=>', JSON.stringify(got));
  if (!ok) { failures++; console.log('     want:', JSON.stringify(want)); }
}

// PLAN section 13 acceptance sentences
expect('I recieved your mesage yesterday.', ['spelling:recieved->received', 'spelling:mesage->message']);
expect('I received your message.', []);
expect('She go to school every day.', ['grammar:go->goes']);
expect('She goes to school every day.', []);
expect('Hello how are you', ['punctuation:->?']);
expect('I recieve', ['spelling:recieve->receive']);
expect('teh quick brown fox', ['spelling:teh->the']);
// regression: common words must NOT flag
expect('The first sentence is correct.', []);
expect('They are happy because you are here.', []);
expect('I have a dog and you have a cat.', []);
// more grammar rules
expect('They is happy.', ['grammar:is->are']);
expect('I goes home.', ['grammar:goes->go']);
expect('They plays football.', ['grammar:plays->play']);
expect('Nowadays people likes to travel.', ['grammar:likes->like']);
expect('A brown fox jump over the tree.', ['grammar:jump->jumps']);
expect('Everyone like pizza.', ['grammar:like->likes']);
expect('Nobody know the answer.', ['grammar:know->knows']);
expect('My friend have a car.', ['grammar:have->has']);
expect('Dogs bark loudly.', []);
expect('The dog barks loudly.', []);
expect('A dog house is red.', []);
expect('Let the dog run free.', []);
expect('One answer is correct.', []);
expect('Either answer is fine.', []);
expect('This is a apple.', ['grammar:a->an']);
expect('This is an book.', ['grammar:an->a']);
expect('I saw the the dog.', ['grammar:the the->the']);
expect('Your going to love this.', ['grammar:Your->you\'re']);
expect('Countries try to tackle financial crisis as economy play a vital role.', ['grammar:play->plays']);
expect('Make the baby sleep now.', []);
expect('I watch the bird fly home.', []);
expect('Ideas is important.', ['grammar:is->are']);
expect('The dogs was barking.', ['grammar:was->were']);
expect('The dog are friendly.', ['grammar:are->is']);
expect('She were happy.', ['grammar:were->was']);
expect('I is ready.', ['grammar:is->am']);
expect('I are ready.', ['grammar:are->am']);
expect('I has a car.', ['grammar:has->have']);
expect('There is many reasons.', ['grammar:is->are']);
expect('There was two dogs.', ['grammar:was->were']);
expect('The news is good.', []);
expect('His is bigger.', []);
expect('I was there.', []);
expect('If I were rich.', []);
expect('Dogs likes bones.', ['grammar:likes->like']);
expect('Glass breaks easily.', []);
expect('She has a dog.', []);
expect('Everyone are welcome.', ['grammar:are->is']);
expect('Sometimes rains are heavy.', []);
expect('It is better then that.', ['grammar:then->than']);
expect('The given pie chart illustrate the proportion.', ['grammar:illustrate->illustrates']);
expect('The tree bark is rough.', []);
expect('The water bottle caps are red.', []);
expect('A fish swim quickly.', ['grammar:swim->swims']);
expect('The fish swim fast.', []);
expect('Walk and run fast.', []);
expect('I like dog house designs.', []);
expect('The fox eat apples.', ['grammar:eat->eats']);
expect('Second and third table illustrate the data.', ['grammar:illustrate->illustrates']);
expect('Give dog a bone.', []);
expect('The policy support growth.', ['grammar:support->supports']);
expect('Running water nourish plants.', ['grammar:nourish->nourishes']);
expect('Report bug now.', []);
expect('The report show growth.', ['grammar:show->shows']);
expect('The chart verify the data.', ['grammar:verify->verifies']);
expect('Cancel order please.', []);
expect('Dog eat apples daily.', ['grammar:eat->eats']);
expect('Dog house designs fall apart.', []);
expect('Water boil at 100 degrees.', ['grammar:boil->boils']);
expect('The data show results.', []);
expect('The old chart illustrate the trend.', ['grammar:illustrate->illustrates']);
expect('Running water nourish plants.', ['grammar:nourish->nourishes']);
expect('I could of gone.', ['grammar:of->have']);
expect('Check this ,please', ['punctuation: ,->,']);
// article / preposition / collocation rules (young-age sentences)
expect('At they young age, the individuals do not have any work experience of job.', ['grammar:they young age->a young age', 'grammar:the individuals->individuals', 'grammar:job->the job']);
expect('At a young age, individuals do not have any work experience of the job.', []);
expect('However, working in young age provides diverse skills to people, which they can apply them in their daily life style in order to increase quality of living.', ['grammar:in young age->at a young age', 'grammar:to->for', 'grammar:apply them->apply', 'grammar:life style->lifestyle', 'grammar:quality->their quality']);
expect('However, working at a young age provides diverse skills for people, which they can apply in their daily lifestyle in order to increase their quality of living.', []);
expect('Working on young age is common.', ['grammar:on young age->at a young age']);
expect('He bought a new life style magazine.', ['grammar:life style->lifestyle']);
expect('The skills that they use it daily are useful.', ['grammar:use it->use']);
expect('We must improve quality in our work.', ['grammar:quality->the quality']);
expect('They provide skills to students every day.', ['grammar:to->for']);
expect('The individuals were interviewed.', []);
expect('The individuals do not have jobs.', ['grammar:The individuals->Individuals']);
// pronoun / case rules
expect('Me and my friend went to the market.', ['grammar:Me->I']);
expect('Between you and I, this is wrong.', ['grammar:I->me']);
expect('John and myself are going to the party.', ['grammar:myself->I']);
expect('A gift for John and myself.', ['grammar:myself->me']);
expect('i am happy today.', ['grammar:i->I']);
expect('their going to the beach', ['grammar:their->they\'re']);
expect('They where happy yesterday.', ['grammar:where->were']);
expect('She where sad last night.', ['grammar:where->was']);
// modal / auxiliary rules
expect('He don\'t like coffee.', ['grammar:don\'t->doesn\'t']);
expect('They doesn\'t work here.', ['grammar:doesn\'t->don\'t']);
expect('She can goes to school.', ['grammar:goes->go']);
expect('He will went home.', ['grammar:went->go']);
expect('I can to swim.', ['grammar:to swim->swim']);
expect('We must to finish this.', ['grammar:to finish->finish']);
expect('She wants to goes.', ['grammar:goes->go']);
expect('He did walked to work.', ['grammar:walked->walk']);
expect('They have went to Italy.', ['grammar:went->gone']);
expect('I am agree with you.', ['grammar:am agree->agree']);
expect('The team is consist of five players.', ['grammar:is consist of->consists of']);
expect('Each of them are ready.', ['grammar:are->is']);
expect('One of the reasons are simple.', ['grammar:are->is']);
expect('The police is coming.', ['grammar:is->are']);
// determiners
expect('There are much reasons for this.', ['grammar:much->many']);
expect('She bought many book.', ['grammar:book->books']);
expect('There are less students than before.', ['grammar:less->fewer']);
expect('Each reasons matter.', ['grammar:reasons->reason']);
expect('These book is good.', ['grammar:book->books']);
expect('This books are old.', ['grammar:This->These']);
expect('He read a books.', ['grammar:books->book']);
// word forms
expect('She gave me advices.', ['spelling:advices->advice']);
expect('Two childs were playing.', ['spelling:childs->children']);
expect('This is more better than that.', ['grammar:more better->better']);
expect('That was the most best one.', ['grammar:most best->best']);
expect('I eat alot of rice.', ['spelling:alot->a lot']);
expect('I do this everyday.', ['grammar:everyday->every day']);
expect('every day life is busy.', ['grammar:every day life->everyday life']);
expect('I need to loose weight.', ['grammar:loose->lose']);
expect('The rain had an affect on the match.', ['grammar:affect->effect']);
expect('This is a quite place.', ['grammar:quite->quiet']);
expect('The food was quiet good.', ['grammar:quiet->quite']);
// verb complements
expect('I enjoy to play cricket.', ['grammar:to play->playing']);
expect('I enjoys to play cricket.', ['grammar:enjoys->enjoy', 'grammar:to play->playing']);
expect('She wants to going home.', ['grammar:going->go']);
expect('I look forward to hear from you.', ['grammar:hear->hearing']);
expect('I used to smoking.', ['grammar:smoking->smoke']);
expect('She is used to working late.', []);
// prepositions / collocations
expect('I wake up in morning.', ['grammar:morning->the morning']);
expect('We met on weekend.', ['grammar:weekend->the weekend']);
expect('She is married with John.', ['grammar:with->to']);
expect('Success depend of effort.', ['grammar:depend->depends', 'grammar:of->on']);
expect('I am interested on art.', ['grammar:on->in']);
expect('Please listen me.', ['grammar:me->to me']);
expect('We arrive to the station.', ['grammar:to->at']);
expect('They discussed about the plan.', ['grammar:discussed about->discussed']);
expect('Please return back the book.', ['grammar:return back->return']);
expect('He repeated again the question.', ['grammar:repeated again->repeated']);
expect('Despite of the rain, we played.', ['grammar:Despite of->Despite']);
expect('Inspite of the rain, we played.', ['spelling:Inspite->in spite']);
expect('According to me, this is best.', ['grammar:According to me->In my opinion']);
expect('In my point of view, it works.', ['grammar:In my point of view->From my point of view']);
expect('On my opinion, this is wrong.', ['grammar:On->In']);
expect('In the other hand, he is right.', ['grammar:In->On']);
expect('I did a mistake in the test.', ['grammar:did a mistake->made a mistake']);
expect('Please take a look on this.', ['grammar:on->at']);
expect('Education play vital role in growth.', ['grammar:play->plays', 'grammar:vital->a vital']);
expect('She is good in English.', ['grammar:in->at']);
// intro-comma punctuation
expect('However he is right.', ['grammar:->,']);
expect('However, he is right.', []);
// sentence-range helper (PLAN section 6)
const doc = 'The first sentence is correct. The second sentnce has an error. The third sentence is also correct.';
const r = currentSentenceRange(doc, doc.indexOf('sentnce') + 3);
console.log((r[0] === 30 && r[1] === 63 ? 'PASS' : 'FAIL'), 'sentence range', JSON.stringify(r));

// active word (still being typed) is never flagged
function expectActive(label, text, caret, wantCount) {
  const span = activeTokenSpan(text, caret);
  const got = api.checkSpelling(text, span);
  const ok = got.length === wantCount;
  console.log((ok ? 'PASS' : 'FAIL'), label, '=>', JSON.stringify(got.map((e) => e.originalText)));
  if (!ok) failures++;
}
expectActive('typing at end of partial word', 'I reciev', 8, 0);
expectActive('editing inside word', 'I recieve your', 5, 0);
expectActive('completed word with space after', 'I recieve ', 10, 1);
expectActive('completed word, caret moved on', 'I recieve your', 12, 1);
expectActive('caret at word start checks it', 'recieve', 0, 1);
expectActive('partial first of two errors', 'recieve mesage', 4, 1); // only mesage

process.exit(failures ? 1 : 0);
