// PhotoShare β デモアプリ。意図的なバグを残してある。
(function () {
  const start = document.getElementById('start');
  const signup = document.getElementById('signup');
  const thanks = document.getElementById('thanks');
  const form = document.getElementById('signup-form');
  const result = document.getElementById('result');

  start.addEventListener('click', function () {
    signup.hidden = false;
    start.scrollIntoView({ behavior: 'smooth' });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const data = new FormData(form);
    const password = data.getAll('password')[0] || form.querySelectorAll('input[type=password]')[0].value;
    const confirm  = form.querySelectorAll('input[type=password]')[1].value;
    if (password !== confirm) {
      // 故意に不親切なエラー文言
      result.textContent = 'ERR_PW_001: input invalid';
      result.className = 'error';
      thanks.hidden = false;
      return;
    }
    // 故意に「登録完了」しか返さない（次に何をすべきか案内なし）
    result.textContent = '登録完了';
    result.className = 'ok';
    thanks.hidden = false;
    signup.hidden = true;
  });
})();
