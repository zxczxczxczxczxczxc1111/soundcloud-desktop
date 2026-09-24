// Состояние приходит из main целиком: заголовок, строка статуса, проценты, подпись кнопки
(() => {
    const api = window.updateScreen;
    const title = document.getElementById('title');
    const status = document.getElementById('status');
    const fill = document.getElementById('fill');
    const bar = fill.parentElement;
    const later = document.getElementById('later');
    later.addEventListener('click', () => api.later());
    api.onState((state) => {
        if (!state || typeof state !== 'object') return;
        title.textContent = String(state.title || '');
        status.textContent = String(state.status || '');
        const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
        fill.style.width = percent + '%';
        bar.setAttribute('aria-valuenow', String(Math.round(percent)));
        later.textContent = String(state.later || '');
        // Когда установщик уже запущен, отказаться нельзя: клиент закрывается
        later.hidden = state.installing === true;
    });
})();
