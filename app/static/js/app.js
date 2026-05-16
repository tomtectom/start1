'use strict';

// Toggle password visibility
document.querySelectorAll('.toggle-pw').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? '👁' : '🙈';
  });
});

// Auto-dismiss flash messages after 6s
document.querySelectorAll('.flash').forEach(el => {
  setTimeout(() => el.remove(), 6000);
});
