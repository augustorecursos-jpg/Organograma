// Utilitários compartilhados entre as páginas.
async function api(url, opcoes = {}) {
  const init = { credentials: 'same-origin', ...opcoes };
  if (init.body && !(init.body instanceof FormData) && typeof init.body !== 'string') {
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(init.body);
  }
  const resp = await fetch(url, init);
  const tipo = resp.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resp.json() : await resp.text();
  if (!resp.ok) {
    const erro = new Error((dados && dados.erro) || 'Erro inesperado');
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

/** Campo "CPF ou CI": com 11 números aplica a máscara do CPF; com menos, deixa o CI como foi digitado. */
function mascaraCpf(input) {
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '');
    if (d.length === 11 && !/[a-z]/i.test(input.value)) input.value = formatarCpf(d);
  });
}

/** Mesma regra do servidor: 4 a 11 números (CPF ou CI). */
function documentoValido(valor) {
  const d = String(valor).replace(/\D/g, '');
  return d.length >= 4 && d.length <= 11;
}

function formatarCpf(cpf) {
  if (String(cpf).startsWith('CI')) return `CI ${String(cpf).slice(2)}`;
  return String(cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _toastTimer;
function toast(msg, tipo = '') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${tipo}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
