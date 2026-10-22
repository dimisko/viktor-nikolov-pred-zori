/* The five truths the player must uncover, in order. The sidebar shows q until revealed, then a. Revealing "location" wins. */
export const SECRETS = [
  { k: "presence", q: "Бил ли во станот?",        a: "Бил во станот на Ристевски" },
  { k: "killer",   q: "Кој го избоде Ристевски?", a: "Ненад Цекиќ „Цеко“" },
  { k: "boss",     q: "Кој ги испрати?",          a: "Бранко Мицевски" },
  { k: "deadline", q: "Зошто гледа во часовникот?", a: "Мора да му се јави на Цеко до 06:00" },
  { k: "location", q: "Каде е Сара?",             a: "Котларницата, „Резиденција Вардар“, Кисела Вода" }
];
