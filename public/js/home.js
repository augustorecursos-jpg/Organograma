// Página de entrada: números gerais da estrutura e acesso por CPF.
const campo = document.getElementById('cpf');
const msg = document.getElementById('acesso-msg');
mascaraCpf(campo);
if (matchMedia('(min-width: 901px)').matches) campo.focus();

// Já entrou antes? Vai direto para o organograma.
api('/api/sessao').then(r => { if (r.ativa) location.replace('organograma.html'); }).catch(() => {});

api('/api/publico/resumo').then((r) => {
  if (!r.colaboradores) return;
  const itens = [
    [r.colaboradores, 'colaboradores'], [r.liderancas, 'lideranças'], [r.diretorias, 'diretorias'], [r.filiais, 'unidades'],
  ];
  const dl = document.getElementById('numeros');
  dl.innerHTML = itens.map(([n, rotulo]) => `<div><dt>${rotulo}</dt><dd data-alvo="${n}">0</dd></div>`).join('');
  dl.hidden = false;
  // Contagem animada até o número final.
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / 1100), suave = 1 - (1 - t) ** 3;
    dl.querySelectorAll('dd').forEach(dd => { dd.textContent = Math.round(dd.dataset.alvo * suave).toLocaleString('pt-BR'); });
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
  if (r.importado_em) {
    const data = new Date(r.importado_em.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR');
    document.getElementById('atualizado').textContent = `Base atualizada em ${data}`;
  }
}).catch(() => {});

document.getElementById('form-acesso').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  if (campo.value.replace(/\D/g, '').length < 8) { msg.textContent = 'Informe um CPF válido.'; campo.focus(); return; }
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    await api('/api/entrar', { method: 'POST', body: { cpf: campo.value } });
    location.href = 'organograma.html';
  } catch (err) {
    msg.textContent = err.message;
    btn.disabled = false;
  }
});
