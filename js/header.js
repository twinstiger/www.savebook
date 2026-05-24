// header.js - Clean horizontal nav with dropdowns
document.addEventListener('DOMContentLoaded', function() {
    var currentPath = window.location.pathname;
    var currentPage = currentPath.split('/').pop() || 'index.html';
    var isInSubdir = currentPath.includes('/pages/') || currentPath.includes('/guides') || currentPath.includes('/seasonal');

    function getPath(target) {
        if (target === 'index.html') return isInSubdir ? '../index.html' : 'index.html';
        if (isInSubdir && target !== 'index.html') {
            // guides/ and seasonal/ are subdirs of pages/
            if (target.startsWith('pages/')) return target.replace('pages/', '');
            return '../' + target;
        }
        return target.startsWith('pages/') || target.startsWith('guides/') || target.startsWith('seasonal/') ? target : 'pages/' + target;
    }

    function isActive(page) { return currentPage === page; }

    var navHTML = '<ul class="nav-links">';

    // Home
    navHTML += '<li><a href="' + getPath('index.html') + '" class="' + (isActive('index.html') ? 'active' : '') + '">Home</a></li>';

    // Guides (dropdown)
    navHTML += '<li><span class="nav-item dropdown-toggle ' + (isActive('barn-finds.html') || isActive('game-systems.html') || isActive('collect.html') || isActive('tuning.html') || isActive('newbie.html') || isActive('touge.html') ? 'active' : '') + '">Guides</span>';
    navHTML += '<ul class="dropdown">';
    navHTML += '<li><a href="' + getPath('pages/barn-finds.html') + '">Barn Finds</a></li>';
    navHTML += '<li><a href="' + getPath('pages/game-systems.html') + '">Game Systems</a></li>';
    navHTML += '<li><a href="' + getPath('pages/collect.html') + '">Collectibles</a></li>';
    navHTML += '<li><a href="' + getPath('pages/tuning.html') + '">Tuning</a></li>';
    navHTML += '<li><a href="' + getPath('pages/newbie.html') + '">Newbie Guide</a></li>';
    navHTML += '<li><a href="' + getPath('pages/touge.html') + '">Touge / Track</a></li>';
    navHTML += '</ul></li>';

    // Seasonal (dropdown)
    navHTML += '<li><span class="nav-item dropdown-toggle ' + (isActive('s1-2026.html') ? 'active' : '') + '">Seasonal</span>';
    navHTML += '<ul class="dropdown">';
    navHTML += '<li><a href="' + (isInSubdir ? 'index.html' : 'pages/seasonal/index.html') + '">Season 1 2026</a></li>';
    navHTML += '</ul></li>';

    // Track
    navHTML += '<li><a href="' + getPath('pages/track.html') + '" class="' + (isActive('track.html') ? 'active' : '') + '">Track</a></li>';

    // Car
    navHTML += '<li><a href="' + getPath('pages/car.html') + '" class="' + (isActive('car.html') ? 'active' : '') + '">Car</a></li>';

    // Tools
    navHTML += '<li><a href="' + getPath('pages/tools.html') + '" class="' + (isActive('tools.html') ? 'active' : '') + '">Tools</a></li>';

    // Contact
    navHTML += '<li><a href="' + getPath('pages/contact.html') + '" class="' + (isActive('contact.html') ? 'active' : '') + '">Contact</a></li>';

    navHTML += '</ul>';

    // Hamburger
    var hamburger = '<button class="hamburger" aria-label="Menu" onclick="this.classList.toggle(\'open\');document.querySelector(\'.nav-links\').classList.toggle(\'open\')">';
    hamburger += '<span></span><span></span><span></span></button>';

    // Dark mode toggle
    var themeToggle = '<button id="theme-toggle" aria-label="Toggle dark/light mode" onclick="document.body.classList.toggle(\'light-mode\')">🌙</button>';

    var container = document.querySelector('.nav-container');
    if (container) {
        // Build right side
        var rightDiv = document.createElement('div');
        rightDiv.className = 'nav-right';
        rightDiv.innerHTML = navHTML + themeToggle + hamburger;

        // Logo
        var logo = container.querySelector('.logo');
        if (!logo) {
            logo = document.createElement('a');
            logo.href = isInSubdir ? '../index.html' : 'index.html';
            logo.className = 'logo';
            logo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 50" width="160" height="33"><text x="0" y="35" font-family="Orbitron,Arial Black,sans-serif" font-weight="900" font-size="30" fill="#f1faee">savebook</text><text x="148" y="35" font-family="Orbitron,Arial Black,sans-serif" font-weight="400" font-size="18" fill="#8a8a8a">.net</text><rect x="150" y="12" width="16" height="16" fill="#e63946" rx="2"/><rect x="153" y="15" width="5" height="5" fill="#f1faee"/><rect x="160" y="15" width="5" height="5" fill="#f1faee"/><rect x="153" y="22" width="5" height="5" fill="#f1faee"/><rect x="160" y="22" width="5" height="5" fill="#f1faee"/></svg>';
            container.insertBefore(logo, container.firstChild);
        }

        container.appendChild(rightDiv);
    }

    // Dropdown hover
    var dropdownItems = document.querySelectorAll('.nav-links li');
    dropdownItems.forEach(function(item) {
        var toggle = item.querySelector('.dropdown-toggle');
        var dropdown = item.querySelector('.dropdown');
        if (toggle && dropdown) {
            item.addEventListener('mouseenter', function() { dropdown.style.display = 'flex'; });
            item.addEventListener('mouseleave', function() { dropdown.style.display = 'none'; });
        }
    });
});
