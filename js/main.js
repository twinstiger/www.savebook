// savebook.net main script

// 返回顶部按钮功能
document.addEventListener('DOMContentLoaded', function() {
    // 创建返回顶部按钮
    var btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.innerHTML = '↑';
    btn.title = 'Back to Top';
    document.body.appendChild(btn);

    // 滚动时显示/隐藏按钮
    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    });

    // 点击返回顶部
    btn.addEventListener('click', function() {
        window.scrollTo({top: 0, behavior: 'smooth'});
    });
});

// Google AdSense 自动加载所有广告位
(function() {
    var ads = document.querySelectorAll('.adsbygoogle');
    ads.forEach(function(ad) {
        (adsbygoogle = window.adsbygoogle || []).push({});
    });
})();