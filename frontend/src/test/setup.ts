import '@testing-library/jest-dom/vitest';

// `scrollIntoView` non esiste in jsdom: i componenti che portano il fuoco su un elemento
// (la chat delle comunicazioni lo fa a ogni messaggio nuovo) facevano fallire il test con
// «Not implemented», un errore che non parla di ciò che si sta verificando. È una lacuna
// dell'ambiente, non un comportamento dell'applicazione: qui si sostituisce con una funzione
// che non fa niente, così resta visibile solo ciò che il test vuole davvero misurare.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* jsdom: non c'è da scorrere */ };
}

// Svuota il localStorage prima di ogni test: molte utility (rbac, tenant, http) leggono
// la sessione da lì, e un test che lascia il token in giro falsifica il successivo.
beforeEach(() => {
  localStorage.clear();
});
