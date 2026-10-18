(function() {
  var html = document.documentElement;
  var themeToggle = document.getElementById('theme-toggle');
  var lightIcon = document.querySelector('.theme-icon-light');
  var darkIcon = document.querySelector('.theme-icon-dark');
  if (!themeToggle || !lightIcon || !darkIcon) return;
  var savedTheme = localStorage.getItem('theme') || 'light';
  html.setAttribute('data-bs-theme', savedTheme);
  function updateIcons(theme) {
    if (theme === 'dark') {
      lightIcon.classList.add('d-none');
      darkIcon.classList.remove('d-none');
    } else {
      lightIcon.classList.remove('d-none');
      darkIcon.classList.add('d-none');
    }
  }
  updateIcons(savedTheme);
  themeToggle.addEventListener('click', function() {
    var currentTheme = html.getAttribute('data-bs-theme');
    var newTheme = currentTheme === 'light' ? 'dark' : 'light';
    html.setAttribute('data-bs-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateIcons(newTheme);
  });
})();
