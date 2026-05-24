// savebook.net main script

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').then(function(reg) {
      console.log('SW registered:', reg.scope);
    }).catch(function(err) {
      console.log('SW registration failed:', err);
    });
  });
}

// Back to top button
document.addEventListener('DOMContentLoaded', function() {
    var btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.innerHTML = '↑';
    btn.title = 'Back to Top';
    document.body.appendChild(btn);

    window.addEventListener('scroll', function() {
        btn.classList.toggle('visible', window.scrollY > 300);
    });

    btn.addEventListener('click', function() {
        window.scrollTo({top: 0, behavior: 'smooth'});
    });
});

// Google AdSense auto-load
(function() {
    var ads = document.querySelectorAll('.adsbygoogle');
    ads.forEach(function(ad) {
        (adsbygoogle = window.adsbygoogle || []).push({});
    });
})();
