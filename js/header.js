// Header组件 - 用于所有页面动态加载导航
document.addEventListener('DOMContentLoaded', function() {
    // 获取当前页面路径
    const currentPath = window.location.pathname;
    const currentPage = currentPath.split('/').pop() || 'index.html';
    
    // 判断是否在子目录
    const isInSubdir = currentPath.includes('/pages/');
    
    // 定义导航项 - 使用相对路径
    const navItems = [
        { name: 'Home', url: 'index.html', page: 'index.html' },
        { name: 'System Specs', url: 'system-requirements.html', page: 'system-requirements.html' },
        { name: 'Beginner Guide', url: 'newbie.html', page: 'newbie.html' },
        { name: 'Track Guides', url: 'track.html', page: 'track.html' },
        { name: 'Car List', url: 'car.html', page: 'car.html' },
        { name: 'Car Tuning', url: 'tuning.html', page: 'tuning.html' },
        { name: 'Rare Cars', url: 'barn-finds.html', page: 'barn-finds.html' },
        { name: 'Collectibles', url: 'collect.html', page: 'collect.html' },
        { name: 'Game Systems', url: 'game-systems.html', page: 'game-systems.html' },
        { name: 'Updates', url: 'news.html', page: 'news.html' },
        { name: 'Tools', url: 'tools.html', page: 'tools.html' },
        { name: 'Contact Us', url: 'contact.html', page: 'contact.html' }
    ];
    
    // 生成导航HTML
    let navHtml = '<nav class="nav-tabs">';
    navItems.forEach(item => {
        const isActive = currentPage === item.page ? ' active' : '';
        // 根据当前页面位置生成正确的链接
        let linkUrl;
        if (item.page === 'index.html') {
            // 首页特殊处理
            linkUrl = isInSubdir ? '../index.html' : 'index.html';
        } else {
            // 其他页面
            linkUrl = isInSubdir ? item.url : 'pages/' + item.url;
        }
        navHtml += `<a href="${linkUrl}" class="nav-tab${isActive}">${item.name}</a>`;
    });
    navHtml += '</nav>';
    
    // 替换或创建header中的nav元素
    const headerContainer = document.querySelector('.nav-container');
    if (headerContainer) {
        const existingNav = headerContainer.querySelector('nav');
        if (existingNav) {
            existingNav.outerHTML = navHtml;
        } else {
            // 如果没有nav元素，直接添加到nav-container
            headerContainer.insertAdjacentHTML('beforeend', navHtml);
        }
    }
});
