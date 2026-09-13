import '@testing-library/jest-dom/vitest';

// Svuota il localStorage prima di ogni test: molte utility (rbac, tenant, http) leggono
// la sessione da lì, e un test che lascia il token in giro falsifica il successivo.
beforeEach(() => {
  localStorage.clear();
});
