(function () {
  if (window.__YAKTUBE_ENGINE_LOADED__) return;
  window.__YAKTUBE_ENGINE_LOADED__ = true;
  console.log('[YakTube] YakNet SSO, Custom Branding, A11y & On-Demand Engine Active');

  // Dynamic Instance Name Helper
  function getInstanceName() {
    if (
      window.PeertubeServerConfig &&
      window.PeertubeServerConfig.instance &&
      window.PeertubeServerConfig.instance.name
    ) {
      return window.PeertubeServerConfig.instance.name;
    }
    var metaSite = document.querySelector('meta[property="og:site_name"]');
    if (metaSite && metaSite.content) return metaSite.content;
    var brandEl = document.querySelector('.header-left .brand-name, .instance-name, a.brand');
    if (brandEl && brandEl.textContent) return brandEl.textContent.trim();
    return 'YakTube';
  }

  // 1. Screen Reader Live Announcer
  var liveRegion = null;
  function getLiveRegion() {
    if (!liveRegion || !document.body.contains(liveRegion)) {
      liveRegion = document.getElementById('yaktube-a11y-live-region');
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.id = 'yaktube-a11y-live-region';
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.className = 'yaktube-sr-only';
        document.body.appendChild(liveRegion);
      }
    }
    return liveRegion;
  }

  function announce(text, assertive) {
    var region = getLiveRegion();
    if (assertive) {
      region.setAttribute('aria-live', 'assertive');
    } else {
      region.setAttribute('aria-live', 'polite');
    }
    region.textContent = '';
    setTimeout(function () {
      region.textContent = text;
    }, 50);
  }

  function triggerYakNetOAuth() {
    sessionStorage.removeItem('yaknet_manual_logout');
    var callbackUrl = 'https://yaktube.yakhub.com.tr/plugins/peertube-plugin-auth-yaknet/router/auth-callback';
    window.location.href =
      'https://auth.yakhub.com.tr/oauth/authorize?client_id=01a03c41-f758-721e-b927-619bffde5c23&redirect_uri=' +
      encodeURIComponent(callbackUrl) +
      '&response_type=code&scope=';
  }

  // Handle direct postMessage from YakNet SSO frame
  window.addEventListener('message', function (ev) {
    if (ev.data && ev.data.type === 'YAKNET_SSO_STATUS') {
      if (ev.data.authenticated && ev.data.user) {
        var token = localStorage.getItem('access_token');
        if (
          !token &&
          !window.location.search.includes('local=true') &&
          !window.location.search.includes('externalAuthError')
        ) {
          sessionStorage.removeItem('yaknet_manual_logout');
          console.log('[YakTube] Live YakNet session detected via SSO frame! Connecting...', ev.data.user);
          triggerYakNetOAuth();
        }
      } else if (ev.data.authenticated === false) {
        var hasToken = localStorage.getItem('access_token') || localStorage.getItem('username');
        if (hasToken) {
          console.log('[YakTube] YakNet session ended elsewhere. Clearing YakTube...');
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch (e) {}
          window.location.reload();
        }
      }
    }
  });

  // Global listener for YakNet SSO broadcast from auth.yakhub.com.tr
  window.addEventListener('yaknet-auth', function (e) {
    if (e.detail && e.detail.authenticated && e.detail.user) {
      var token = localStorage.getItem('access_token');
      if (
        !token &&
        !window.location.search.includes('local=true') &&
        !window.location.search.includes('externalAuthError')
      ) {
        sessionStorage.removeItem('yaknet_manual_logout');
        console.log('[YakTube] Initiating automatic single-sign-on handshake for:', e.detail.user);
        triggerYakNetOAuth();
      }
    } else if (e.detail && e.detail.authenticated === false) {
      var hasToken = localStorage.getItem('access_token') || localStorage.getItem('username');
      if (hasToken) {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (err) {}
        window.location.reload();
      }
    }
  });

  // Unified single sign-out for YakTube and YakNet
  function performUnifiedLogout() {
    try {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('yaknet_manual_logout', 'true');
    } catch (err) {}
    window.location.replace(
      'https://auth.yakhub.com.tr/sdk/logout?redirect_uri=' + encodeURIComponent('https://yaktube.yakhub.com.tr')
    );
  }

  document.addEventListener(
    'click',
    function (e) {
      var el = e.target;
      if (el && el.closest) {
        var isLogout = el.closest(
          'a[href*="logout"], button[title*="Log out"], button[title*="Çıkış"], .logout-button, [class*="logout"], [aria-label*="Çıkış"], [aria-label*="Log out"]'
        );
        if (isLogout) {
          e.preventDefault();
          e.stopPropagation();
          performUnifiedLogout();
          return;
        }
        var isLogin = el.closest(
          'my-login-link, .login-button, a[href*="/login"]:not(#yaktube-show-admin-login), a[aria-label*="Giriş"], a[title*="Giriş"], a[title*="login"], a[aria-label*="login"], .yaknet-sso-login-btn'
        );
        if (isLogin && !window.location.search.includes('local=true')) {
          e.preventDefault();
          e.stopPropagation();
          sessionStorage.removeItem('yaknet_manual_logout');
          triggerYakNetOAuth();
          return;
        }
      }
    },
    true
  );

  // 2.3 Dedicated Local Admin Login Modal (Alt+A)
  function openLocalAdminLoginModal() {
    var existingModal = document.getElementById('yaktube-admin-login-modal');
    if (existingModal) {
      existingModal.style.display = 'flex';
      var uInput = existingModal.querySelector('#yaktube-admin-username');
      if (uInput) uInput.focus();
      return;
    }

    var modal = document.createElement('div');
    modal.id = 'yaktube-admin-login-modal';
    modal.className = 'yaktube-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'yaktube-admin-modal-title');

    modal.innerHTML =
      '<div class="yaktube-modal-card" style="max-width: 420px; background:#181824; border:1px solid rgba(255,143,55,0.4); border-radius:18px; padding:26px; color:#fff; box-shadow:0 16px 40px rgba(0,0,0,0.8); text-align:left;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">' +
      '<h3 id="yaktube-admin-modal-title" style="margin:0; font-size:18px; color:#ff8f37;">⚙️ Sunucu Yöneticisi Girişi</h3>' +
      '<button id="yaktube-admin-modal-close" class="yaktube-voice-modal-close-btn" aria-label="Kapat">✕</button>' +
      '</div>' +
      '<p style="font-size:13px; color:#aaa; margin-bottom:16px;">Yerel yönetici (admin) kullanıcı adı ve şifrenizle giriş yaparak PeerTube yönetim paneline erişebilirsiniz.</p>' +
      '<form id="yaktube-admin-direct-form" style="display:flex; flex-direction:column; gap:12px;">' +
      '<div style="display:flex; flex-direction:column; gap:4px;">' +
      '<label for="yaktube-admin-username" style="font-size:13px; font-weight:600; color:#ddd;">Kullanıcı Adı veya E-posta:</label>' +
      '<input type="text" id="yaktube-admin-username" required style="background:#22222e; border:1px solid #444; border-radius:8px; padding:10px 12px; color:#fff; font-size:14px; outline:none;" />' +
      '</div>' +
      '<div style="display:flex; flex-direction:column; gap:4px;">' +
      '<label for="yaktube-admin-password" style="font-size:13px; font-weight:600; color:#ddd;">Şifre:</label>' +
      '<input type="password" id="yaktube-admin-password" required style="background:#22222e; border:1px solid #444; border-radius:8px; padding:10px 12px; color:#fff; font-size:14px; outline:none;" />' +
      '</div>' +
      '<div id="yaktube-admin-login-error" style="color:#ef4444; font-size:13px; display:none; margin-top:4px;"></div>' +
      '<button type="submit" id="yaktube-admin-login-submit" style="background:linear-gradient(135deg, #ff8f37 0%, #ff5e3a 100%); color:#fff; border:none; border-radius:8px; padding:12px; font-weight:700; font-size:14px; cursor:pointer; margin-top:6px;">Yönetici Olarak Giriş Yap</button>' +
      '</form>' +
      '</div>';

    document.body.appendChild(modal);

    modal.querySelector('#yaktube-admin-modal-close').addEventListener('click', function () {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.style.display = 'none';
    });

    var form = modal.querySelector('#yaktube-admin-direct-form');
    var errEl = modal.querySelector('#yaktube-admin-login-error');
    var uInput = modal.querySelector('#yaktube-admin-username');
    var pInput = modal.querySelector('#yaktube-admin-password');
    var sBtn = modal.querySelector('#yaktube-admin-login-submit');

    uInput.focus();

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      errEl.style.display = 'none';
      sBtn.disabled = true;
      sBtn.innerText = 'Giriş Yapılıyor...';

      try {
        var clientRes = await fetch('/api/v1/oauth-clients/local');
        var clientData = await clientRes.json();

        var bodyParams = new URLSearchParams({
          client_id: clientData.client_id,
          client_secret: clientData.client_secret,
          grant_type: 'password',
          username: uInput.value.trim(),
          password: pInput.value
        });

        var tokenRes = await fetch('/api/v1/users/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: bodyParams.toString()
        });

        var tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || tokenData.error || 'Kullanıcı adı veya şifre hatalı.');
        }

        // Store tokens
        localStorage.setItem('access_token', tokenData.access_token);
        localStorage.setItem('refresh_token', tokenData.refresh_token);
        localStorage.setItem('token_type', tokenData.token_type || 'Bearer');
        localStorage.setItem('username', uInput.value.trim());

        // Get user details
        var meRes = await fetch('/api/v1/users/me', {
          headers: { Authorization: 'Bearer ' + tokenData.access_token }
        });
        if (meRes.ok) {
          var meData = await meRes.json();
          localStorage.setItem('email', meData.email || '');
          localStorage.setItem('displayName', meData.displayName || meData.username || '');
        }

        announce('Yönetici girişi başarılı! Yönetim paneline yönlendiriliyorsunuz.', true);
        window.location.href = '/admin';
      } catch (err) {
        errEl.innerText = err.message;
        errEl.style.display = 'block';
        sBtn.disabled = false;
        sBtn.innerText = 'Yönetici Olarak Giriş Yap';
      }
    });
  }

  // 2. YakNet SSO Header & Login Flow
  function injectYakNetSSO() {
    // 2.1 Header: Place YakNet Account widget in top-right .buttons-container
    var headerRight =
      document.querySelector('my-header .buttons-container') ||
      document.querySelector('.buttons-container') ||
      document.querySelector('my-header .header-right') ||
      document.querySelector('my-header .user-menu') ||
      document.querySelector('my-header .action-buttons') ||
      document.querySelector('.header-right') ||
      document.querySelector('header .right');

    var token = localStorage.getItem('access_token');
    var uName = localStorage.getItem('username');
    var uEmail = localStorage.getItem('email');
    var displayName = localStorage.getItem('displayName') || uName || '';
    var emailStr = uEmail || '';
    var isAuth = !!token && !!uName;

    if (headerRight) {
      var defaultLoginLink = headerRight.querySelector('my-login-link, a[href*="/login"], .login-button');
      var liveWidget = headerRight.querySelector('#yaknet-header-account-widget');

      if (isAuth) {
        // Logged In: Show YakNet Profile Menu, Hide default login link
        if (defaultLoginLink) {
          defaultLoginLink.style.display = 'none';
          defaultLoginLink.setAttribute('aria-hidden', 'true');
        }

        if (!liveWidget) {
          var widgetWrap = document.createElement('div');
          widgetWrap.id = 'yaknet-header-account-widget';
          widgetWrap.className = 'yaknet-header-widget';
          widgetWrap.style.display = 'inline-flex';
          widgetWrap.style.alignItems = 'center';
          widgetWrap.style.marginRight = '8px';

          widgetWrap.innerHTML =
            '<yaknet-account ' +
            'client-id="01a03c41-f758-721e-b927-619bffde5c23" ' +
            'redirect-uri="https://yaktube.yakhub.com.tr/plugins/peertube-plugin-auth-yaknet/router/auth-callback" ' +
            'base-url="https://auth.yakhub.com.tr" ' +
            'login-url="/login" ' +
            'authenticated="true" ' +
            'user-name="' +
            displayName.replace(/"/g, '&quot;') +
            '" ' +
            'user-email="' +
            emailStr.replace(/"/g, '&quot;') +
            '" ' +
            'theme="dark">' +
            '</yaknet-account>';

          var targetSibling =
            headerRight.querySelector('my-user-menu') ||
            headerRight.querySelector('.user-menu') ||
            headerRight.querySelector('.settings-button') ||
            headerRight.querySelector('my-user-notifications') ||
            headerRight.querySelector('my-notification-bell');

          if (targetSibling && targetSibling.parentElement === headerRight) {
            headerRight.insertBefore(widgetWrap, targetSibling);
          } else {
            headerRight.prepend(widgetWrap);
          }
        } else {
          var el = liveWidget.querySelector('yaknet-account');
          if (el) {
            if (el.shadowRoot) {
              var shadowLogoutBtn =
                el.shadowRoot.getElementById('logoutBtn') ||
                el.shadowRoot.querySelector('.yn-logout-btn') ||
                el.shadowRoot.querySelector('button[title*="Çıkış"], button[aria-label*="Çıkış"]');
              if (shadowLogoutBtn && !shadowLogoutBtn.hasAttribute('data-yaktube-hooked')) {
                shadowLogoutBtn.setAttribute('data-yaktube-hooked', 'true');
                shadowLogoutBtn.addEventListener(
                  'click',
                  function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    performUnifiedLogout();
                  },
                  true
                );
              }
            }

            if (el.getAttribute('authenticated') !== 'true' || el.getAttribute('user-name') !== displayName) {
              el.setAttribute('authenticated', 'true');
              el.setAttribute('user-name', displayName);
              el.setAttribute('user-email', emailStr);
              if (typeof el.syncStateFromAttributes === 'function') {
                el.syncStateFromAttributes();
                el.render();
              }
            }
          }
        }
      } else {
        // Not Logged In: Remove YakNet widget to eliminate duplicate button, keep PeerTube native login button clean
        if (liveWidget) {
          liveWidget.remove();
        }
        if (defaultLoginLink) {
          defaultLoginLink.style.display = '';
          defaultLoginLink.removeAttribute('aria-hidden');

          var loginAnchor =
            defaultLoginLink.tagName.toLowerCase() === 'a' ? defaultLoginLink : defaultLoginLink.querySelector('a');
          if (loginAnchor) {
            loginAnchor.setAttribute('aria-label', 'YakNet ile Giriş Yap');
            loginAnchor.setAttribute('title', 'YakNet Hesabınız ile Giriş Yapın');
            var spanText = loginAnchor.querySelector('span');
            if (spanText) {
              spanText.textContent = 'YakNet ile Giriş Yap';
            } else {
              loginAnchor.textContent = 'YakNet ile Giriş Yap';
            }
          }
        }
      }
    }

    // 2.2 Login Modal / Page
    var loginCard =
      document.querySelector('my-login') ||
      document.querySelector('.login-page') ||
      document.querySelector('.login-container') ||
      document.querySelector('form.login') ||
      document.querySelector('form[action*="login"]') ||
      document.querySelector('my-login-modal');

    if (loginCard && !document.getElementById('yaknet-login-section')) {
      var isLocalLogin = window.location.search.includes('local=true') || window.location.pathname.includes('/admin');

      var ssoBox = document.createElement('div');
      ssoBox.id = 'yaknet-login-section';
      ssoBox.className = 'yaknet-login-banner';
      ssoBox.innerHTML =
        '<div style="font-size: 19px; font-weight: 700; color: #ff8f37; margin-bottom: 6px;">YakNet ile YakTube\'a Katılın</div>' +
        '<p style="font-size: 13px; color: #94a3b8; margin-bottom: 16px; line-height: 1.45;">' +
        'YouTube gibi tek bir YakNet hesabıyla güvenle giriş yapabilir, kendi video ve müzik kanallarınızı oluşturabilirsiniz.' +
        '</p>' +
        '<a href="https://auth.yakhub.com.tr/oauth/authorize?client_id=01a03c41-f758-721e-b927-619bffde5c23&redirect_uri=https%3A%2F%2Fyaktube.yakhub.com.tr%2Fplugins%2Fpeertube-plugin-auth-yaknet%2Frouter%2Fauth-callback&response_type=code&scope=" class="yaknet-sso-login-btn" aria-label="YakNet Hesabınız ile Tek Tıkla Giriş Yapın">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
        '<span>YakNet ile Giriş Yap</span>' +
        '</a>' +
        '<div style="margin-top: 14px; font-size: 13px; color: #94a3b8;">' +
        'YakNet hesabınız yok mu? <a href="https://auth.yakhub.com.tr/register" target="_blank" rel="noopener noreferrer" style="color: #ff8f37; font-weight: 600; text-decoration: underline;">YakNet Hesabı Oluştur</a>' +
        '</div>' +
        '<div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 11.5px; color: #64748b; line-height: 1.45;">' +
        'Giriş yaparak <a href="/about/instance" target="_blank" style="color: #94a3b8; text-decoration: underline;">Kullanım Koşulları</a>\'nı ve <a href="/about/instance" target="_blank" style="color: #94a3b8; text-decoration: underline;">Gizlilik Politikası</a>\'nı kabul etmiş sayılırsınız.' +
        '</div>' +
        '<div class="yaktube-admin-login-link" style="margin-top: 14px;">' +
        (isLocalLogin
          ? '<span>⚙️ Yönetici (Local Admin) Giriş Modu Aktif</span>'
          : '<a href="#" id="yaktube-show-admin-login">⚙️ Sunucu Yöneticisi Girişi</a>') +
        '</div>';

      var formFirstChild = loginCard.firstElementChild;
      if (formFirstChild) {
        loginCard.insertBefore(ssoBox, formFirstChild);
      } else {
        loginCard.appendChild(ssoBox);
      }

      var registerLinks = document.querySelectorAll('a[href*="/signup"], a[href*="/register"]');
      registerLinks.forEach(function (l) {
        l.href = 'https://auth.yakhub.com.tr/register';
        l.target = '_blank';
        l.innerText = 'YakNet Hesabı Oluştur';
      });

      var formInputs = loginCard.querySelector('.form-group, .inputs, form') || loginCard.querySelector('input');
      var containerToHide = formInputs ? formInputs.closest('form') || formInputs.parentElement : null;

      if (containerToHide && !isLocalLogin) {
        var subElements = Array.from(loginCard.children).filter(function (el) {
          return (
            el.id !== 'yaknet-login-section' && !el.classList.contains('title') && !el.classList.contains('page-title')
          );
        });

        subElements.forEach(function (el) {
          el.style.display = 'none';
        });

        var showAdminBtn = document.getElementById('yaktube-show-admin-login');
        if (showAdminBtn) {
          showAdminBtn.addEventListener('click', function (e) {
            e.preventDefault();
            openLocalAdminLoginModal();
          });
        }
      }
    }
  }

  // 3. Intelligent Branding & A11y DOM Auto-Fixer
  function autoFixDOM() {
    injectAccessiblePlayerBar();

    // Check if on 403 / unauthorized page and provide admin login button
    var notAuthorizedEl = document.querySelector('my-not-found, .not-found, .forbidden, my-forbidden, .error-page');
    if (notAuthorizedEl && !document.getElementById('yaktube-403-admin-btn')) {
      var btn403 = document.createElement('div');
      btn403.id = 'yaktube-403-admin-btn';
      btn403.style.margin = '20px auto';
      btn403.style.textAlign = 'center';
      btn403.innerHTML =
        '<button style="background:linear-gradient(135deg, #ff8f37 0%, #ff5e3a 100%); color:#fff; border:none; padding:12px 24px; border-radius:10px; font-weight:700; cursor:pointer; font-size:15px;">🔑 Sunucu Yöneticisi Olarak Giriş Yap (Alt+A)</button>';
      btn403.querySelector('button').addEventListener('click', openLocalAdminLoginModal);
      notAuthorizedEl.appendChild(btn403);
    }

    injectYakNetSSO();

    // Replace all login buttons labels and titles
    document
      .querySelectorAll(
        'my-login-link, a[href*="/login"], a[title*="Giriş sayfasına git"], [aria-label*="Giriş sayfasına git"]'
      )
      .forEach(function (el) {
        if (el.getAttribute('title') && el.getAttribute('title').includes('Giriş sayfasına git')) {
          el.setAttribute('title', 'YakNet ile Giriş Yap');
        }
        if (el.getAttribute('aria-label') && el.getAttribute('aria-label').includes('Giriş sayfasına git')) {
          el.setAttribute('aria-label', 'YakNet ile Giriş Yap');
        }
        var anchor = el.tagName.toLowerCase() === 'a' ? el : el.querySelector('a');
        if (anchor) {
          anchor.setAttribute('title', 'YakNet ile Giriş Yap');
          anchor.setAttribute('aria-label', 'YakNet ile Giriş Yap');
          var spans = anchor.querySelectorAll('span');
          spans.forEach(function (s) {
            if (
              s.textContent.includes('Giriş sayfasına git') ||
              s.textContent.trim() === 'Giriş' ||
              s.textContent.trim() === 'Giriş yap'
            ) {
              s.textContent = 'YakNet ile Giriş Yap';
            }
          });
        }
      });

    // Aggressively remove generic Framasoft Open-in-App / Play Store banners
    var genericAppBanners = document.querySelectorAll(
      'my-open-app, my-client-app-banner, .open-app-container, .app-banner, [class*="open-app"], [class*="open-in-app"], .mobile-app-banner, my-open-in-app, .app-promotion, a[href*="play.google.com/store/apps/details?id=app.joinpeertube"], a[href*="f-droid.org"]'
    );
    genericAppBanners.forEach(function (banner) {
      banner.setAttribute('aria-hidden', 'true');
      banner.setAttribute('tabindex', '-1');
      if (banner.parentElement) {
        try {
          banner.remove();
        } catch (e) {
          banner.style.display = 'none';
        }
      }
    });

    // Replace leftover PeerTube branding in visible UI texts
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var val = node.nodeValue;
      if (val && (val.includes('PeerTube') || val.includes('Peertube'))) {
        var parentTag = node.parentElement ? node.parentElement.tagName : '';
        var parentElem = node.parentElement;
        if (
          parentElem &&
          (parentElem.closest('#yaktube-ondemand-container') ||
            parentElem.closest('#yaktube-live-watch-container') ||
            parentElem.tagName === 'SCRIPT' ||
            parentElem.tagName === 'STYLE')
        ) {
          continue;
        }
        if (true) {
          node.nodeValue = val
            .replace(/PeerTube hakkında/gi, 'YakTube Hakkında')
            .replace(/PeerTube'a katılın/gi, "YakTube'a Katılın")
            .replace(/PeerTube örneği/gi, 'YakTube Sunucusu')
            .replace(/PeerTube/g, 'YakTube')
            .replace(/Giriş sayfasına git/gi, 'YakNet ile Giriş Yap');
        }
      }
    }

    // Semantic Headings (H3 for video titles, H2 for sections)
    document
      .querySelectorAll('.video-miniature, my-video-miniature, .video-card, .yaktube-card, [class*="miniature"]')
      .forEach(function (card) {
        var titleElement = card.querySelector(
          '.video-miniature-name, .video-name, .yaktube-video-name, a[title], .title'
        );
        if (titleElement) {
          if (!['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(titleElement.tagName)) {
            titleElement.setAttribute('role', 'heading');
            titleElement.setAttribute('aria-level', '3');
          }
        }
      });

    document
      .querySelectorAll('.section-title, .sub-header, .videos-header, .page-header, .yaktube-title-h3')
      .forEach(function (sec) {
        if (!['H1', 'H2'].includes(sec.tagName)) {
          sec.setAttribute('role', 'heading');
          sec.setAttribute('aria-level', '2');
        }
      });

    // Make native PeerTube comment authors accessible as H3 headings for screen readers
    document
      .querySelectorAll('my-video-comment, .video-comment, my-video-comment-thread, .comment, .comment-thread')
      .forEach(function (commentEl) {
        var authorEl = commentEl.querySelector(
          '.display-name, .actor-name, .comment-author, a.actor-link, .video-comment-header-left a, .video-comment-header-left span'
        );
        if (
          authorEl &&
          !['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(authorEl.tagName) &&
          !authorEl.getAttribute('role')
        ) {
          authorEl.setAttribute('role', 'heading');
          authorEl.setAttribute('aria-level', '3');
        }
      });

    // Auto-fix unlabeled buttons
    document.querySelectorAll('button:not([data-a11y-fixed])').forEach(function (btn) {
      btn.setAttribute('data-a11y-fixed', 'true');
      var text = (btn.textContent || '').trim();
      var hasAria = btn.getAttribute('aria-label') || btn.getAttribute('title');

      if (!text && !hasAria) {
        var html = btn.innerHTML.toLowerCase();
        var className = (btn.className || '').toLowerCase();
        var icon = btn.querySelector('my-global-icon, i, svg, [class*="icon-"]');
        var iconName = icon ? icon.className || icon.getAttribute('name') || '' : '';

        if (html.includes('search') || className.includes('search') || iconName.includes('search')) {
          btn.setAttribute('aria-label', 'Ara');
        } else if (html.includes('bell') || className.includes('notification') || iconName.includes('bell')) {
          btn.setAttribute('aria-label', 'Bildirimler');
        } else if (html.includes('cog') || html.includes('setting') || className.includes('setting')) {
          btn.setAttribute('aria-label', 'Ayarlar');
        } else if (
          html.includes('menu') ||
          html.includes('bars') ||
          className.includes('burger') ||
          className.includes('menu')
        ) {
          btn.setAttribute('aria-label', 'Ana Gezinme Menüsü');
        } else if (html.includes('play') || className.includes('play')) {
          btn.setAttribute('aria-label', 'Oynat');
        } else if (html.includes('pause') || className.includes('pause')) {
          btn.setAttribute('aria-label', 'Duraklat');
        } else if (html.includes('volume') || html.includes('mute') || className.includes('volume')) {
          btn.setAttribute('aria-label', 'Ses Kontrolü');
        } else if (html.includes('fullscreen') || className.includes('fullscreen')) {
          btn.setAttribute('aria-label', 'Tam Ekran');
        } else if (
          html.includes('ellipsis') ||
          html.includes('more') ||
          className.includes('more') ||
          className.includes('action')
        ) {
          btn.setAttribute('aria-label', 'Diğer İşlemler ve Seçenekler');
        } else if (html.includes('trash') || html.includes('delete') || className.includes('delete')) {
          btn.setAttribute('aria-label', 'Sil');
        } else if (html.includes('edit') || className.includes('edit')) {
          btn.setAttribute('aria-label', 'Düzenle');
        } else if (html.includes('share') || className.includes('share')) {
          btn.setAttribute('aria-label', 'Paylaş');
        } else if (html.includes('thumb-up') || html.includes('like') || className.includes('like')) {
          btn.setAttribute('aria-label', 'Beğen');
        } else if (html.includes('thumb-down') || html.includes('dislike') || className.includes('dislike')) {
          btn.setAttribute('aria-label', 'Beğenme');
        } else if (html.includes('filter') || className.includes('filter')) {
          btn.setAttribute('aria-label', 'Filtreler');
        } else if (html.includes('close') || html.includes('times') || className.includes('close')) {
          btn.setAttribute('aria-label', 'Kapat');
        } else if (btn.closest('.vjs-control-bar')) {
          btn.setAttribute('aria-label', 'Oynatıcı Düğmesi');
        } else {
          var parent = btn.parentElement;
          if (parent && parent.title) {
            btn.setAttribute('aria-label', parent.title);
          } else {
            btn.setAttribute('aria-label', 'Düğme');
          }
        }
      }
    });

    // Auto-fix unlabeled images
    document.querySelectorAll('img:not([data-a11y-fixed])').forEach(function (img) {
      img.setAttribute('data-a11y-fixed', 'true');
      var alt = img.getAttribute('alt');
      if (!alt || alt.trim() === '') {
        var card = img.closest('.video-miniature, .video-card, .yaktube-card, [class*="miniature"]');
        if (card) {
          var titleEl = card.querySelector('.video-miniature-name, .video-name, .yaktube-video-name, h3, h4, a[title]');
          var titleText = titleEl ? (titleEl.textContent || titleEl.getAttribute('title') || '').trim() : '';
          if (titleText) {
            img.setAttribute('alt', titleText + ' video kapağı');
            return;
          }
        }

        var avatarContainer = img.closest('.actor-avatar, .channel-avatar, .avatar, [class*="avatar"]');
        if (avatarContainer) {
          var nameEl = avatarContainer.parentElement
            ? avatarContainer.parentElement.querySelector('.name, .actor-name, .channel-name')
            : null;
          var nameText = nameEl ? (nameEl.textContent || '').trim() : '';
          img.setAttribute('alt', (nameText ? nameText + ' ' : '') + 'Profil Resmi');
          return;
        }

        if (img.src && (img.src.includes('logo') || img.className.includes('logo'))) {
          img.setAttribute('alt', getInstanceName() + ' Logo');
          return;
        }

        var parentLink = img.closest('a');
        if (parentLink && parentLink.textContent && parentLink.textContent.trim().length > 0) {
          img.setAttribute('alt', '');
        } else if (parentLink && parentLink.getAttribute('title')) {
          img.setAttribute('alt', parentLink.getAttribute('title'));
        } else {
          img.setAttribute('alt', 'Görsel');
        }
      }
    });

    // Auto-fix unlabeled links
    document.querySelectorAll('a:not([data-a11y-fixed])').forEach(function (a) {
      a.setAttribute('data-a11y-fixed', 'true');
      var text = (a.textContent || '').trim();
      var hasAria = a.getAttribute('aria-label') || a.getAttribute('title');
      if (!text && !hasAria) {
        var img = a.querySelector('img');
        if (img && img.alt) {
          a.setAttribute('aria-label', img.alt);
        } else if (a.href) {
          if (a.href.includes('/videos/watch/')) {
            a.setAttribute('aria-label', 'Videoyu İzle');
          } else if (a.href.includes('/video-channels/')) {
            a.setAttribute('aria-label', 'Kanal Sayfasına Git');
          } else if (a.href.includes('/accounts/')) {
            a.setAttribute('aria-label', 'Hesap Profiline Git');
          } else if (a.href.includes('/videos/search')) {
            a.setAttribute('aria-label', 'Arama Sayfası');
          } else {
            a.setAttribute('aria-label', 'Bağlantı');
          }
        }
      }
    });

    // Auto-fix search inputs
    document.querySelectorAll('input:not([data-a11y-fixed])').forEach(function (inp) {
      inp.setAttribute('data-a11y-fixed', 'true');
      if (!inp.getAttribute('aria-label') && !inp.getAttribute('placeholder') && !(inp.labels && inp.labels.length)) {
        var type = (inp.getAttribute('type') || 'text').toLowerCase();
        if (type === 'search') {
          inp.setAttribute('aria-label', getInstanceName() + ' Video Arama');
        } else if (type === 'checkbox') {
          inp.setAttribute('aria-label', 'Seçim Kutusu');
        } else if (type === 'password') {
          inp.setAttribute('aria-label', 'Åifre');
        }
      }
    });
  }

  setInterval(autoFixDOM, 1000);

  // 3. Screen-Reader & Turkish Q Optimized Shortcuts & Player Bar (v1.4.1)
  function toggleShortcutsModal() {
    var modal = document.getElementById('yaktube-shortcuts-dialog');
    if (modal) {
      if (modal.style.display === 'none' || !modal.style.display) {
        modal.style.display = 'flex';
        announce('Klavye kısayolları yardım penceresi açıldı. Kapatmak için Escape tuşuna basın.');
        var closeBtn = document.getElementById('yaktube-shortcuts-close');
        if (closeBtn) closeBtn.focus();
      } else {
        modal.style.display = 'none';
        announce('Yardım penceresi kapatıldı.');
      }
    } else {
      modal = document.createElement('div');
      modal.id = 'yaktube-shortcuts-dialog';
      modal.className = 'yaktube-modal-overlay';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'yaktube-shortcuts-title');
      modal.innerHTML =
        '<div class="yaktube-modal-card" style="max-width: 600px; background:#1e1e24; border-radius:18px; padding:24px; color:#fff; box-shadow:0 16px 40px rgba(0,0,0,0.8);">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">' +
        '<h3 id="yaktube-shortcuts-title" style="margin:0; font-size:18px; color:#ff8f37;">⌨️ Klavye Kısayolları (Ekran Okuyucu Uyumlu)</h3>' +
        '<button id="yaktube-shortcuts-close" class="yaktube-voice-modal-close-btn" aria-label="Kapat">✕</button>' +
        '</div>' +
        '<div style="font-size:12px; color:#aaa; margin-bottom:14px;">💡 <b>Ekran Okuyucu Notu:</b> Sanal imleç (Browse mode) açıkken kısayolları <b>Alt</b> tuşuyla birlikte kullanabilir veya video oynatıcı butonlarından faydalanabilirsiniz.</div>' +
        '<table class="yaktube-shortcuts-table" style="width:100%; border-collapse:collapse; font-size:13px;">' +
        '<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1); text-align:left; color:#aaa;"><th style="padding:6px 0;">Kısayol (Evrensel / Tek Tuş)</th><th style="padding:6px 0;">İşlev</th></tr></thead>' +
        '<tbody>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + K</span> veya <span class="yaktube-kbd">Space</span></td><td>Oynat / Duraklat</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + J</span> veya <span class="yaktube-kbd">J</span></td><td>10 saniye geri sar</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + L</span> veya <span class="yaktube-kbd">L</span></td><td>10 saniye ileri sar</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + Yukarı / Aşağı</span></td><td>Sesi %5 artır / azalt</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + M</span> veya <span class="yaktube-kbd">M</span></td><td>Sesi Kapat / Aç (Mute)</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + T</span> veya <span class="yaktube-kbd">T</span></td><td>Sinema / Tiyatro Modu</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + I</span> veya <span class="yaktube-kbd">I</span></td><td>Hızlı Video Bilgisi & İstatistikler</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + C</span> veya <span class="yaktube-kbd">C</span></td><td>Altyazıları Aç / Kapat</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + .</span> / <span class="yaktube-kbd">Alt + ,</span></td><td>Oynatma hızını artır / azalt</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + S</span> veya <span class="yaktube-kbd">/</span> (Shift+7)</td><td>Arama penceresini aç</td></tr>' +
        '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + V</span> veya <span class="yaktube-kbd">Shift + V</span></td><td>Sesli aramayı başlat</td></tr>' +
        '<tr><td style="padding:8px 0;"><span class="yaktube-kbd">Alt + H</span> veya <span class="yaktube-kbd">F1</span> veya <span class="yaktube-kbd">?</span></td><td>Bu kılavuzu aç / kapat</td></tr>' +
        '</tbody>' +
        '</table>' +
        '</div>';
      document.body.appendChild(modal);

      var closeBtn = modal.querySelector('#yaktube-shortcuts-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          modal.style.display = 'none';
        });
      }
      modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.style.display = 'none';
      });

      announce('Klavye kısayolları yardım penceresi açıldı. Kapatmak için Escape tuşuna basın.');
    }
  }

  function isInputFocused() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName ? el.tagName.toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function getVideoElement() {
    return document.querySelector('video');
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0 saniye';
    var mins = Math.floor(seconds / 60);
    var secs = Math.floor(seconds % 60);
    if (mins === 0) return secs + ' saniye';
    return mins + ' dakika ' + secs + ' saniye';
  }

  function showQuickVideoInfo() {
    var video = getVideoElement();
    if (!video) {
      announce('Şu anda aktif oynatılan bir video bulunmuyor.');
      return;
    }

    var titleEl = document.querySelector('h1.video-title, .video-name, my-video-watch h1, .title');
    var title = titleEl ? titleEl.textContent.trim() : 'Video';
    var curTime = formatTime(video.currentTime);
    var totalTime = formatTime(video.duration || 0);
    var remaining = formatTime((video.duration || 0) - video.currentTime);
    var speed = (video.playbackRate || 1) + 'x';
    var volume = Math.round((video.volume || 1) * 100) + '%';
    var quality = video.videoHeight ? video.videoHeight + 'p' : 'Otomatik';

    // Visual Toast
    var existingToast = document.querySelector('.yaktube-video-info-toast');
    if (existingToast) existingToast.remove();

    var toast = document.createElement('div');
    toast.className = 'yaktube-video-info-toast';
    toast.innerHTML =
      '<div class="yaktube-info-toast-title">📊 Video Bilgisi & Durum</div>' +
      '<div class="yaktube-info-toast-row"><span>Başlık:</span> <b>' +
      (title.length > 28 ? title.substring(0, 28) + '...' : title) +
      '</b></div>' +
      '<div class="yaktube-info-toast-row"><span>Konum / Süre:</span> <b>' +
      curTime +
      ' / ' +
      totalTime +
      '</b></div>' +
      '<div class="yaktube-info-toast-row"><span>Kalan Süre:</span> <b>' +
      remaining +
      '</b></div>' +
      '<div class="yaktube-info-toast-row"><span>Çözünürlük:</span> <b>' +
      quality +
      '</b></div>' +
      '<div class="yaktube-info-toast-row"><span>Hız & Ses:</span> <b>' +
      speed +
      ' | ' +
      volume +
      '</b></div>';

    document.body.appendChild(toast);
    setTimeout(function () {
      if (toast.parentElement) toast.remove();
    }, 4000);

    announce(
      'Video Bilgisi: ' +
        title +
        '. Konum: ' +
        curTime +
        ', Toplam Süre: ' +
        totalTime +
        ', Kalan: ' +
        remaining +
        ', Oynatma Hızı: ' +
        speed +
        ', Ses: yüzde ' +
        Math.round(video.volume * 100) +
        ', Çözünürlük: ' +
        quality,
      true
    );
  }

  var speedSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function adjustPlaybackSpeed(increase) {
    var video = getVideoElement();
    if (!video) return;
    var curSpeed = video.playbackRate || 1;
    if (increase) {
      var nextIdx = speedSteps.findIndex(function (s) {
        return s > curSpeed;
      });
      video.playbackRate = nextIdx !== -1 ? speedSteps[nextIdx] : 2;
      announce('Oynatma hızı ' + video.playbackRate + ' katına çıkarıldı.');
    } else {
      var prevSteps = speedSteps.filter(function (s) {
        return s < curSpeed;
      });
      video.playbackRate = prevSteps.length > 0 ? prevSteps[prevSteps.length - 1] : 0.25;
      announce('Oynatma hızı ' + video.playbackRate + ' katına düşürüldü.');
    }
  }

  // 3.1. Injects Accessible Player Action Bar under the Watch Video
  function injectAccessiblePlayerBar() {
    if (!window.location.pathname.includes('/videos/watch/')) return;
    var video = getVideoElement();
    if (!video) return;

    var targetContainer = document.querySelector(
      'my-video-watch, .video-watch, .watch-container, #yaktube-ondemand-container'
    );
    if (!targetContainer) return;

    var existingBar = document.getElementById('yaktube-player-action-bar');
    if (existingBar) return;

    var bar = document.createElement('div');
    bar.id = 'yaktube-player-action-bar';
    bar.className = 'yaktube-player-action-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Erişilebilir Video Kontrolleri');

    bar.innerHTML =
      '<span class="yaktube-player-bar-label">⚡ Oynatıcı Kontrolleri:</span>' +
      '<button id="yaktube-bar-rewind-btn" class="yaktube-player-action-btn" aria-label="10 Saniye Geri Sar (Alt+J)">⏪ 10sn Geri</button>' +
      '<button id="yaktube-bar-play-btn" class="yaktube-player-action-btn" aria-label="Oynat veya Duraklat (Alt+K)">⏯️ Oynat/Duraklat</button>' +
      '<button id="yaktube-bar-forward-btn" class="yaktube-player-action-btn" aria-label="10 Saniye İleri Sar (Alt+L)">⏩ 10sn İleri</button>' +
      '<button id="yaktube-bar-speed-btn" class="yaktube-player-action-btn" aria-label="Oynatma Hızını Değiştir (Alt+.)">⚡ Hız</button>' +
      '<button id="yaktube-bar-theater-btn" class="yaktube-player-action-btn" aria-label="Sinema Modunu Aç/Kapat (Alt+T)">🎭 Sinema</button>' +
      '<button id="yaktube-bar-info-btn" class="yaktube-player-action-btn" aria-label="Video Bilgisi ve İstatistikleri (Alt+I)">📊 Bilgi</button>' +
      '<button id="yaktube-bar-help-btn" class="yaktube-player-action-btn" aria-label="Kısayol Kılavuzu (Alt+H veya F1)">⌨️ Kısayollar</button>';

    var playerWrap =
      document.querySelector('.player-container, .video-player-container, .player-wrapper, my-video-watch .player') ||
      targetContainer;
    if (playerWrap && playerWrap.nextSibling) {
      playerWrap.parentNode.insertBefore(bar, playerWrap.nextSibling);
    } else {
      targetContainer.prepend(bar);
    }

    // Attach button actions
    bar.querySelector('#yaktube-bar-rewind-btn').addEventListener('click', function () {
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - 10);
        announce('10 saniye geri sarıldı. Konum: ' + formatTime(video.currentTime));
      }
    });

    bar.querySelector('#yaktube-bar-play-btn').addEventListener('click', function () {
      if (video) {
        if (video.paused) {
          video.play();
          announce('Video oynatılıyor.');
        } else {
          video.pause();
          announce('Video duraklatıldı.');
        }
      }
    });

    bar.querySelector('#yaktube-bar-forward-btn').addEventListener('click', function () {
      if (video) {
        video.currentTime = Math.min(video.duration || 99999, video.currentTime + 10);
        announce('10 saniye ileri sarıldı. Konum: ' + formatTime(video.currentTime));
      }
    });

    bar.querySelector('#yaktube-bar-speed-btn').addEventListener('click', function () {
      adjustPlaybackSpeed(true);
    });

    bar.querySelector('#yaktube-bar-theater-btn').addEventListener('click', function () {
      document.body.classList.toggle('yaktube-theater-mode');
      var isT = document.body.classList.contains('yaktube-theater-mode');
      announce(isT ? 'Sinema modu açıldı.' : 'Sinema modundan çıkıldı.');
    });

    bar.querySelector('#yaktube-bar-info-btn').addEventListener('click', function () {
      showQuickVideoInfo();
    });

    bar.querySelector('#yaktube-bar-help-btn').addEventListener('click', function () {
      toggleShortcutsModal();
    });
  }

  // 4. Global Keydown Listener (Screen-Reader & Turkish Q Optimized)
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var shortcutsModal = document.getElementById('yaktube-shortcuts-dialog');
      if (shortcutsModal && shortcutsModal.style.display !== 'none') {
        shortcutsModal.style.display = 'none';
        announce('Pencere kapatıldı.');
        return;
      }
      var importModal = document.getElementById('yaktube-import-modal');
      if (importModal && importModal.style.display !== 'none') {
        importModal.style.display = 'none';
        announce('İndirme penceresi kapatıldı.');
        return;
      }
      if (isInputFocused()) {
        document.activeElement.blur();
      }
      return;
    }

    // Admin Login: Alt+A
    if (e.altKey && (e.key === 'a' || e.key === 'A') && !isInputFocused()) {
      e.preventDefault();
      openLocalAdminLoginModal();
      return;
    }

    // Help Dialog: Alt+H, F1 or '?' key
    if ((e.altKey && (e.key === 'h' || e.key === 'H')) || e.key === 'F1' || e.key === '?') {
      if (!isInputFocused()) {
        e.preventDefault();
        toggleShortcutsModal();
        return;
      }
    }

    // Search Open: Alt+S, Ctrl+K or '/' key (Turkish Q Shift+7)
    if (
      ((e.altKey && (e.key === 's' || e.key === 'S')) ||
        (e.ctrlKey && (e.key === 'k' || e.key === 'K')) ||
        e.key === '/') &&
      !isInputFocused()
    ) {
      e.preventDefault();
      openFullSearchModal('', false);
      return;
    }

    // Voice Search Open: Alt+V or Shift+V
    if (
      ((e.altKey && (e.key === 'v' || e.key === 'V')) || (e.shiftKey && (e.key === 'v' || e.key === 'V'))) &&
      !isInputFocused()
    ) {
      e.preventDefault();
      openFullSearchModal('', true);
      return;
    }

    if (isInputFocused()) {
      return;
    }

    var video = getVideoElement();
    if (!video) return;

    var key = e.key.toLowerCase();
    var alt = e.altKey;

    // Play / Pause (Alt+K, Space or K)
    if (key === ' ' || key === 'k' || (alt && key === 'k')) {
      e.preventDefault();
      if (video.paused) {
        video.play();
        announce('Video oynatılıyor.');
      } else {
        video.pause();
        announce('Video duraklatıldı.');
      }
    }
    // Seek 10s Back / Forward (Alt+J / Alt+L or J / L)
    else if (key === 'j' || (alt && key === 'j')) {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 10);
      announce('10 saniye geri sarıldı. Konum: ' + formatTime(video.currentTime));
    } else if (key === 'l' || (alt && key === 'l')) {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || 99999, video.currentTime + 10);
      announce('10 saniye ileri sarıldı. Konum: ' + formatTime(video.currentTime));
    }
    // Seek 5s Back / Forward (ArrowLeft / ArrowRight or Alt+Left/Right)
    else if (e.key === 'ArrowLeft' || (alt && e.key === 'ArrowLeft')) {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 5);
      announce('5 saniye geri sarıldı. Konum: ' + formatTime(video.currentTime));
    } else if (e.key === 'ArrowRight' || (alt && e.key === 'ArrowRight')) {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || 99999, video.currentTime + 5);
      announce('5 saniye ileri sarıldı. Konum: ' + formatTime(video.currentTime));
    }
    // Volume Up / Down (ArrowUp / ArrowDown or Alt+Up/Down)
    else if (e.key === 'ArrowUp' || (alt && e.key === 'ArrowUp')) {
      e.preventDefault();
      video.volume = Math.min(1, (video.volume || 1) + 0.05);
      announce('Ses seviyesi yüzde ' + Math.round(video.volume * 100));
    } else if (e.key === 'ArrowDown' || (alt && e.key === 'ArrowDown')) {
      e.preventDefault();
      video.volume = Math.max(0, (video.volume || 1) - 0.05);
      announce('Ses seviyesi yüzde ' + Math.round(video.volume * 100));
    }
    // Mute (Alt+M or M)
    else if (key === 'm' || (alt && key === 'm')) {
      e.preventDefault();
      video.muted = !video.muted;
      announce(video.muted ? 'Ses kapatıldı (Sessiz).' : 'Ses açıldı.');
    }
    // Fullscreen (Alt+F or F)
    else if (key === 'f' || (alt && key === 'f')) {
      e.preventDefault();
      if (!document.fullscreenElement) {
        var container = video.closest('.video-js') || video.parentElement || video;
        if (container.requestFullscreen) container.requestFullscreen();
        announce('Tam ekran moduna geçildi.');
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
        announce('Tam ekrandan çıkıldı.');
      }
    }
    // Theater Mode (Alt+T or T)
    else if (key === 't' || (alt && key === 't')) {
      e.preventDefault();
      document.body.classList.toggle('yaktube-theater-mode');
      var isTheater = document.body.classList.contains('yaktube-theater-mode');
      announce(isTheater ? 'Sinema modu açıldı.' : 'Sinema modundan çıkıldı.');
    }
    // Quick Video Info (Alt+I or I)
    else if (key === 'i' || (alt && key === 'i')) {
      e.preventDefault();
      showQuickVideoInfo();
    }
    // Subtitles (Alt+C or C)
    else if (key === 'c' || (alt && key === 'c')) {
      e.preventDefault();
      var tracks = video.textTracks;
      if (tracks && tracks.length > 0) {
        var isShowing = tracks[0].mode === 'showing';
        tracks[0].mode = isShowing ? 'disabled' : 'showing';
        announce(isShowing ? 'Altyazılar kapatıldı.' : 'Altyazılar açıldı.');
      } else {
        announce('Bu videoda altyazı bulunmuyor.');
      }
    }
    // Speed Controls (Alt+. / Alt+, or > / <)
    else if ((alt && (e.key === '.' || e.key === '>')) || e.key === '>') {
      e.preventDefault();
      adjustPlaybackSpeed(true);
    } else if ((alt && (e.key === ',' || e.key === '<')) || e.key === '<') {
      e.preventDefault();
      adjustPlaybackSpeed(false);
    }
    // Percentage Jumps (0 - 9)
    else if (key >= '0' && key <= '9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      var percent = parseInt(key, 10) * 10;
      if (video.duration) {
        video.currentTime = (video.duration * percent) / 100;
        announce('Videonun yüzde ' + percent + ' noktasına atlandı. Konum: ' + formatTime(video.currentTime));
      }
    }
  });

  // 5. On-Demand Search & Import with Duplicate Awareness
  var lastQuery = null;
  var isSearching = false;

  function showModal(title, desc) {
    var overlay = document.getElementById('yaktube-import-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'yaktube-import-modal';
      overlay.className = 'yaktube-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'yaktube-modal-title');
      overlay.innerHTML =
        '<div class="yaktube-modal-card">' +
        '<div class="yaktube-spinner" aria-hidden="true"></div>' +
        '<h3 class="yaktube-modal-title" id="yaktube-modal-title" style="margin-top:0;">' +
        (title || "YakTube'a Aktarılıyor...") +
        '</h3>' +
        '<p class="yaktube-modal-desc" id="yaktube-modal-desc">' +
        (desc || 'Seçtiğiniz video D: diskinize aktarılıyor...') +
        '</p>' +
        '</div>';
      document.body.appendChild(overlay);
    } else {
      var titleElem = document.getElementById('yaktube-modal-title');
      var descElem = document.getElementById('yaktube-modal-desc');
      if (titleElem) titleElem.innerText = title;
      if (descElem) descElem.innerText = desc;
      overlay.style.display = 'flex';
    }
    announce((title || '') + '. ' + (desc || ''), true);
  }

  function hideModal() {
    var overlay = document.getElementById('yaktube-import-modal');
    if (overlay) overlay.style.display = 'none';
  }

  function handleLiveStream(url, videoTitle, isRestoring) {
    var videoIdMatch = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
    var videoId = videoIdMatch ? videoIdMatch[1] : '';

    if (!videoId) {
      alert('Canl\u0131 yay\u0131n ID bulunamad\u0131.');
      return;
    }

    // Persist active live stream state in sessionStorage
    try {
      sessionStorage.setItem(
        'yaktube_active_live',
        JSON.stringify({
          url: url,
          title: videoTitle,
          videoId: videoId
        })
      );
    } catch (e) {}

    var liveContainer = document.getElementById('yaktube-live-watch-container');
    if (liveContainer) liveContainer.remove();

    liveContainer = document.createElement('div');
    liveContainer.id = 'yaktube-live-watch-container';
    liveContainer.className = 'yaktube-live-watch-section';
    liveContainer.setAttribute('role', 'region');
    liveContainer.setAttribute('tabindex', '-1');
    liveContainer.setAttribute('aria-label', videoTitle + ' Canl\u0131 Yay\u0131n\u0131');

    liveContainer.innerHTML =
      '<div style="background: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.08); outline: none;">' +
      '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">' +
      '<div style="display: flex; align-items: center; gap: 10px;">' +
      '<span style="background: #dc2626; color: #fff; font-size: 12px; padding: 4px 10px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">\ud83d\udd34 CANLI YAYIN</span>' +
      '<h1 id="yaktube-live-title" tabindex="0" style="margin: 0; font-size: 1.25rem; font-weight: 700; color: #fff; line-height: 1.3; outline: none;">' +
      videoTitle +
      '</h1>' +
      '</div>' +
      '<button id="yaktube-close-live-theater" style="background: #334155; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;" aria-label="Canl\u0131 Yay\u0131n \u0130zleme Alan\u0131n\u0131 Kapat (Escape)">' +
      '\u2715 Yay\u0131n\u0131 Kapat (Esc)' +
      '</button>' +
      '</div>' +
      '<div style="position: relative; padding-top: 56.25%; width: 100%; background: #000; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.7);">' +
      '<iframe id="yaktube-live-iframe" src="https://www.youtube-nocookie.com/embed/' +
      videoId +
      '?autoplay=1&rel=0&modestbranding=1&enablejsapi=1" title="' +
      videoTitle.replace(/"/g, '&quot;') +
      '" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>' +
      '</div>' +
      '<div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 13px;">' +
      '<div>\ud83d\udce1 YakTube Canl\u0131 Yay\u0131n Ak\u0131\u015f\u0131 \u2022 Reklams\u0131z ve Kesintisiz</div>' +
      '<div style="color: #64748b;">ESC tu\u015funa basarak yay\u0131n\u0131 kapatabilirsiniz.</div>' +
      '</div>' +
      '<div id="yaktube-live-comments-panel" style="margin-top: 18px; background: #0b1120; border-radius: 10px; padding: 16px; border: 1px solid rgba(255,255,255,0.08);">' +
      '<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">' +
      '<h2 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">' +
      '\ud83d\udcac YouTube Topluluk Yorumlar\u0131' +
      '</h2>' +
      '<button id="yaktube-toggle-comments-btn" style="background: #ff8f37; color: #000; border: none; padding: 7px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 12px; display: inline-flex; align-items: center; gap: 6px;" aria-label="YouTube yorumlar\u0131n\u0131 y\u00fckle ve g\u00f6ster">' +
      '\ud83d\udcac Yorumlar\u0131 G\u00f6ster (20 Yorum)' +
      '</button>' +
      '</div>' +
      '<div id="yaktube-comments-list" style="display: none; margin-top: 14px; flex-direction: column; gap: 12px;"></div>' +
      '<div id="yaktube-more-comments-wrap" style="text-align: center; margin-top: 16px; display: none;">' +
      '<button id="yaktube-load-more-comments-btn" style="background: #1e293b; color: #ff8f37; border: 1px solid #ff8f37; padding: 8px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;" aria-label="Daha fazla yorum y\u00fckle">' +
      '\u2795 Daha Fazla Yorum G\u00f6ster (+20 Yorum)' +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    var mainMount =
      document.querySelector('my-search, my-search-results, router-outlet, main, .main-col') || document.body;
    if (mainMount && mainMount.firstChild) {
      mainMount.insertBefore(liveContainer, mainMount.firstChild);
    } else if (mainMount) {
      mainMount.appendChild(liveContainer);
    }

    if (!isRestoring) {
      liveContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () {
        var liveTitle = document.getElementById('yaktube-live-title');
        if (liveTitle) liveTitle.focus();
        else liveContainer.focus();
      }, 150);
      announce(
        videoTitle +
          ' canl\u0131 yay\u0131n\u0131 ba\u015flat\u0131ld\u0131. Canl\u0131 yay\u0131n alan\u0131na odaklan\u0131ld\u0131.',
        true
      );
    }

    var commentNextToken = null;
    var commentsList = document.getElementById('yaktube-comments-list');
    var toggleCommentsBtn = document.getElementById('yaktube-toggle-comments-btn');
    var moreCommentsWrap = document.getElementById('yaktube-more-comments-wrap');
    var moreCommentsBtn = document.getElementById('yaktube-load-more-comments-btn');

    function renderCommentCard(c) {
      var card = document.createElement('div');
      card.className = 'yaktube-comment-item';
      card.setAttribute('role', 'article');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', c.author + ' isimli kullan\u0131c\u0131n\u0131n yorumu: ' + c.content);
      card.style.cssText =
        'background: #1e293b; padding: 12px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); display: flex; gap: 12px; align-items: flex-start;';

      var avatarLetter = (c.author || 'U').replace('@', '').charAt(0).toUpperCase();
      var avatarHtml =
        '<div style="width: 36px; height: 36px; border-radius: 50%; background: #334155; color: #ff8f37; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;">' +
        avatarLetter +
        '</div>';

      var safeContent = c.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      card.innerHTML =
        avatarHtml +
        '<div style="flex-grow: 1; min-width: 0;">' +
        '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">' +
        '<h3 class="yaktube-comment-author-heading" style="margin: 0; font-size: 13px; font-weight: 700; color: #f1f5f9; display: inline-block;">' +
        c.author +
        '</h3>' +
        '<span style="color: #64748b; font-size: 11px;">' +
        c.published +
        '</span>' +
        (c.likeCount && c.likeCount !== '0'
          ? '<span style="background: rgba(255,255,255,0.08); color: #94a3b8; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">👍 ' +
            c.likeCount +
            '</span>'
          : '') +
        '</div>' +
        '<div style="color: #cbd5e1; font-size: 13px; line-height: 1.45; word-break: break-word;">' +
        safeContent +
        '</div>' +
        '</div>';

      return card;
    }

    function fetchComments(token) {
      if (!token) {
        toggleCommentsBtn.disabled = true;
        toggleCommentsBtn.textContent = '⏳ Yorumlar Y\u00fckleniyor...';
      } else {
        moreCommentsBtn.disabled = true;
        moreCommentsBtn.textContent = '⏳ Y\u00fckleniyor...';
      }

      var fetchUrl =
        '/api-custom/youtube-comments?id=' +
        encodeURIComponent(videoId) +
        (token ? '&token=' + encodeURIComponent(token) : '');
      fetch(fetchUrl)
        .then(function (r) {
          return r.json();
        })
        .then(function (res) {
          if (!token) {
            commentsList.innerHTML = '';
            commentsList.style.display = 'flex';
            toggleCommentsBtn.textContent = '🔄 Yorumlar\u0131 Yenile';
            toggleCommentsBtn.disabled = false;
          } else {
            moreCommentsBtn.textContent = '➕ Daha Fazla Yorum G\u00f6ster (+20 Yorum)';
            moreCommentsBtn.disabled = false;
          }

          var list = res.comments || [];
          if (list.length === 0 && !token) {
            commentsList.innerHTML =
              '<div style="color: #94a3b8; font-size: 13px; text-align: center; padding: 12px;">Bu videoda/yay\u0131nda hen\u00fcz yorum bulunmuyor.</div>';
            moreCommentsWrap.style.display = 'none';
            announce('Bu videoda henüz yorum bulunmuyor.');
            return;
          }

          list.forEach(function (c) {
            commentsList.appendChild(renderCommentCard(c));
          });

          commentNextToken = res.nextToken;
          if (commentNextToken) {
            moreCommentsWrap.style.display = 'block';
          } else {
            moreCommentsWrap.style.display = 'none';
          }

          announce(list.length + ' adet YouTube yorumu yüklendi.');
        })
        .catch(function (err) {
          if (!token) {
            toggleCommentsBtn.disabled = false;
            toggleCommentsBtn.textContent = '⚠️ Tekrar Dene';
          } else {
            moreCommentsBtn.disabled = false;
            moreCommentsBtn.textContent = '⚠️ Tekrar Dene';
          }
          alert('Yorumlar yüklenirken hata oluştu: ' + err.message);
        });
    }

    if (toggleCommentsBtn) {
      toggleCommentsBtn.addEventListener('click', function () {
        fetchComments(null);
      });
    }
    if (moreCommentsBtn) {
      moreCommentsBtn.addEventListener('click', function () {
        if (commentNextToken) fetchComments(commentNextToken);
      });
    }

    function closeLiveTheater() {
      try {
        sessionStorage.removeItem('yaktube_active_live');
      } catch (e) {}
      if (liveContainer && liveContainer.parentNode) {
        var ifr = liveContainer.querySelector('iframe');
        if (ifr) ifr.src = '';
        liveContainer.remove();
      }
      document.removeEventListener('keydown', handleEsc);
      announce('Canl\u0131 yay\u0131n izleme alan\u0131 kapat\u0131ld\u0131.');
    }

    function handleEsc(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        closeLiveTheater();
      }
    }

    var closeBtn = document.getElementById('yaktube-close-live-theater');
    if (closeBtn) closeBtn.addEventListener('click', closeLiveTheater);
    document.addEventListener('keydown', handleEsc);
  }

  function restoreActiveLiveStream() {
    try {
      var saved = sessionStorage.getItem('yaktube_active_live');
      if (!saved) return;
      var data = JSON.parse(saved);
      if (data && data.url && data.title && !document.getElementById('yaktube-live-watch-container')) {
        handleLiveStream(data.url, data.title, true);
      }
    } catch (e) {}
  }

  function handleImport(url, btn, videoTitle) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Aktarılıyor...';
    showModal(
      '[1/2] 📥 Video İndiriliyor...',
      (videoTitle ? '"' + videoTitle + '" ' : 'Video ') + "YouTube'dan sunucunuza aktarılıyor. Lütfen bekleyin..."
    );

    fetch('/api-custom/ondemand-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: url, title: videoTitle })
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          throw new Error(data && data.error ? data.error : 'İçe aktarma başlatılamadı.');
        }

        var videoId = data.video.id;
        var videoUuid = data.video.uuid;

        var attempts = 0;
        var pollInterval = setInterval(function () {
          attempts++;
          fetch('/api-custom/status/' + videoId)
            .then(function (sRes) {
              return sRes.json();
            })
            .then(function (sData) {
              if (sData.isImporting) {
                showModal('[1/2] 📥 Video İndiriliyor...', 'Video sunucuya indiriliyor (' + attempts * 2 + ' sn)...');
              } else if (sData.isTranscoding) {
                showModal('[2/2] ⚙️ Oynatıcı Hazırlanıyor...', 'Video işleniyor ve yüksek kalite akış hazırlanıyor...');
              }

              if (sData.isPublished || (sData.hasFiles && attempts >= 8)) {
                clearInterval(pollInterval);
                showModal('🎉 Video Hazır!', 'Video kütüphanenize eklendi. Oynatıcı açılıyor...');
                setTimeout(function () {
                  window.location.href = '/videos/watch/' + (sData.uuid || videoUuid);
                }, 600);
              } else if (sData.isFailed) {
                clearInterval(pollInterval);
                hideModal();
                btn.disabled = false;
                btn.innerHTML = "📥 YakTube'a Aktar & İzle";
                alert('Video indirme sırasında bir hata oluştu.');
                announce('Video indirme sırasında bir hata oluştu.', true);
              }
            })
            .catch(function (e) {
              console.error('[YakTube] Status poll error:', e);
            });

          if (attempts > 35) {
            clearInterval(pollInterval);
            hideModal();
            btn.disabled = false;
            btn.innerHTML = "📥 YakTube'a Aktar & İzle";
            alert(
              'İndirme arka planda tamamlanıyor. Ana sayfada veya Videolarım sayfasında kısa süre içinde hazır olacaktır.'
            );
            announce('İndirme arka planda tamamlanıyor. Ana sayfada kısa süre içinde hazır olacaktır.');
          }
        }, 1500);
      })
      .catch(function (err) {
        hideModal();
        btn.disabled = false;
        btn.innerHTML = "📥 YakTube'a Aktar & İzle";
        alert('İndirme hatası: ' + err.message);
        announce('İndirme hatası: ' + err.message, true);
      });
  }

  function checkAndInjectSearchResults() {
    var url = new URL(window.location.href);
    var searchParam = url.searchParams.get('search');

    if (!window.location.pathname.includes('/search') || !searchParam || searchParam.trim().length < 2) {
      var existing = document.getElementById('yaktube-ondemand-container');
      if (existing) existing.remove();
      lastQuery = null;
      return;
    }

    var query = searchParam.trim();
    if (query === lastQuery) return;
    lastQuery = query;

    var container = document.getElementById('yaktube-ondemand-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'yaktube-ondemand-container';
      container.className = 'yaktube-ondemand-section';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Canl\u0131 YouTube Arama Sonu\u00e7lar\u0131');

      var mainContent =
        document.querySelector('my-search, my-search-results, router-outlet, main, .main-col') || document.body;
      if (mainContent && mainContent.firstChild) {
        mainContent.insertBefore(container, mainContent.firstChild);
      } else if (mainContent) {
        mainContent.appendChild(container);
      }
    }

    container.innerHTML =
      '<div class="yaktube-header">' +
      '<div class="yaktube-header-left">' +
      '<span class="yaktube-badge">\u26a1 Canl\u0131 YouTube & Web Arama</span>' +
      '<h2 class="yaktube-title-h3" style="margin:0; font-size:1.15rem;">"' +
      query +
      '" i\u00e7in YouTube Sonu\u00e7lar\u0131 Taran\u0131yor...</h2>' +
      '</div>' +
      '<button class="yaktube-shortcuts-btn" id="yaktube-open-shortcuts" aria-label="Klavye K\u0131sayollar\u0131 K\u0131lavuzunu A\u00e7">' +
      '\u2328\ufe0f K\u0131sayollar (?)' +
      '</button>' +
      '</div>' +
      '<div class="yaktube-loading">' +
      '<div class="yaktube-spinner" aria-hidden="true"></div>' +
      '<div style="margin-top: 10px;">YouTube\'daki en pop\u00fcler e\u015fle\u015fmeler taran\u0131yor...</div>' +
      '</div>';

    var shortcutsBtn = document.getElementById('yaktube-open-shortcuts');
    if (shortcutsBtn) {
      shortcutsBtn.addEventListener('click', toggleShortcutsModal);
    }

    announce(query + ' i\u00e7in canl\u0131 YouTube aramas\u0131 ba\u015flat\u0131ld\u0131.');
    isSearching = true;

    fetch('/api-custom/youtube-search?q=' + encodeURIComponent(query))
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var rawResults = data.results || [];
        var uniqueResults = [];
        var seenIds = {};

        rawResults.forEach(function (item) {
          if (item && item.id && !seenIds[item.id] && item.title) {
            seenIds[item.id] = true;
            uniqueResults.push(item);
          }
        });

        var count = uniqueResults.length;
        if (count === 0) {
          container.innerHTML =
            '<div class="yaktube-header">' +
            '<div class="yaktube-header-left">' +
            '<span class="yaktube-badge">⚡ Canlı YouTube & Web Arama</span>' +
            '<h2 class="yaktube-title-h3" style="margin:0; font-size:1.15rem;">"' +
            query +
            '" için YouTube\'da Sonuç Bulunamadı</h2>' +
            '</div>' +
            '</div>';
          announce(query + " için YouTube\'da eşleşen video bulunamadı.");
        } else {
          var countText = count === 1 ? '1 Video Bulundu' : count + ' Video Bulundu';
          announce(query + ' araması için ' + count + ' video listelendi.');
          var visibleCount = Math.min(12, count);

          function render() {
            var visibleResults = uniqueResults.slice(0, visibleCount);
            var cardsHtml = '';
            visibleResults.forEach(function (item) {
              var isLocal = !!item.isDownloaded;
              var isLive = !!item.isLive;

              var statusBadge = '';
              if (isLive) {
                statusBadge =
                  '<span class="yaktube-badge" style="background: #dc2626; color: #fff; margin-bottom: 6px; display: inline-block; font-weight: 700;">🔴 CANLI YAYIN</span>';
              } else if (isLocal) {
                statusBadge =
                  '<span class="yaktube-badge" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); margin-bottom: 6px; display: inline-block;">✅ ' +
                  getInstanceName() +
                  "'da Mevcut</span>";
              }

              var actionButton = '';
              if (isLive) {
                actionButton =
                  '<button class="yaktube-live-btn" data-url="' +
                  item.url +
                  '" data-title="' +
                  item.title.replace(/"/g, '&quot;') +
                  '" style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" aria-label="' +
                  item.title.replace(/"/g, '&quot;') +
                  ' canlı yayınını hemen izle">🔴 Canlı Yayını İzle</button>';
              } else if (isLocal) {
                actionButton =
                  '<a href="' +
                  item.localVideo.url +
                  '" class="yaktube-play-btn" aria-label="' +
                  item.title.replace(/"/g, '&quot;') +
                  ' videosunu YakTube\'dan hemen izle">▶️ ' +
                  getInstanceName() +
                  "'dan İzle</a>";
              } else {
                actionButton =
                  '<button class="yaktube-import-btn" data-url="' +
                  item.url +
                  '" data-title="' +
                  item.title.replace(/"/g, '&quot;') +
                  '" aria-label="' +
                  item.title.replace(/"/g, '&quot;') +
                  ' videosunu ' +
                  getInstanceName() +
                  '\'a indir ve izle">📥 ' +
                  getInstanceName() +
                  "'a Aktar & İzle</button>";
              }

              var durationText = isLive ? 'CANLI' : item.durationFormatted;
              var cardLabel =
                item.title +
                (isLive ? ' (Canlı Yayın)' : isLocal ? ' (' + getInstanceName() + ' kütüphanenizde mevcut)' : '') +
                ', ' +
                item.channel +
                ' kanalı, Süre: ' +
                durationText;
              cardsHtml +=
                '<div class="yaktube-card" role="article" tabindex="0" aria-label="' +
                cardLabel.replace(/"/g, '&quot;') +
                '">' +
                '<div class="yaktube-thumb-wrap">' +
                '<img class="yaktube-thumb-img" src="' +
                item.thumbnail +
                '" alt="' +
                item.title.replace(/"/g, '&quot;') +
                '" loading="lazy" />' +
                '<span class="yaktube-duration-badge" style="' +
                (isLive ? 'background:#dc2626;font-weight:700;' : '') +
                '" aria-label="Süre">' +
                durationText +
                '</span>' +
                '</div>' +
                '<div class="yaktube-info">' +
                '<div>' +
                statusBadge +
                '<h3 class="yaktube-video-name" title="' +
                item.title +
                '" style="margin:0; font-size:13px; font-weight:600; line-height:1.35;">' +
                item.title +
                '</h3>' +
                '<div class="yaktube-channel-name">' +
                item.channel +
                '</div>' +
                '</div>' +
                actionButton +
                '</div>' +
                '</div>';
            });

            var loadMoreHtml = '';
            if (visibleCount < count) {
              loadMoreHtml =
                '<div style="text-align: center; margin: 20px 0 10px 0;">' +
                '<button id="yaktube-load-more-btn" class="yaktube-load-more-btn" style="background: #1e293b; color: #ff8f37; border: 1px solid #ff8f37; padding: 10px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.3);" aria-label="Daha fazla video yükle">' +
                '➕ Daha Fazla Video Göster (' +
                visibleCount +
                ' / ' +
                count +
                ')' +
                '</button>' +
                '</div>';
            }

            container.innerHTML =
              '<div class="yaktube-header">' +
              '<div class="yaktube-header-left">' +
              '<span class="yaktube-badge">⚡ Canlı YouTube & Web Arama</span>' +
              '<h2 class="yaktube-title-h3" style="margin:0; font-size:1.15rem;">"' +
              query +
              '" için ' +
              countText +
              '</h2>' +
              '</div>' +
              '<button class="yaktube-shortcuts-btn" id="yaktube-open-shortcuts" aria-label="Klavye Kısayolları Kılavuzunu Aç">' +
              '⌨️ Kısayollar (?)' +
              '</button>' +
              '</div>' +
              '<div class="yaktube-grid">' +
              cardsHtml +
              '</div>' +
              loadMoreHtml;

            var sBtn = document.getElementById('yaktube-open-shortcuts');
            if (sBtn) {
              sBtn.addEventListener('click', toggleShortcutsModal);
            }

            var loadMoreBtn = document.getElementById('yaktube-load-more-btn');
            if (loadMoreBtn) {
              loadMoreBtn.addEventListener('click', function () {
                visibleCount = Math.min(visibleCount + 6, count);
                render();
                announce(visibleCount + ' adet video gösteriliyor.');
              });
            }

            container.querySelectorAll('.yaktube-live-btn').forEach(function (btn) {
              btn.addEventListener('click', function (e) {
                var liveUrl = e.currentTarget.getAttribute('data-url');
                var liveTitle = e.currentTarget.getAttribute('data-title');
                handleLiveStream(liveUrl, liveTitle);
              });
            });

            container.querySelectorAll('.yaktube-import-btn').forEach(function (btn) {
              btn.addEventListener('click', function (e) {
                var videoUrl = e.currentTarget.getAttribute('data-url');
                var videoTitle = e.currentTarget.getAttribute('data-title');
                handleImport(videoUrl, e.currentTarget, videoTitle);
              });
            });
          }

          render();
        }
      })
      .catch(function (err) {
        console.error('[YakTube] Search fetch error:', err);
        container.innerHTML =
          '<div class="yaktube-header">' +
          '<div class="yaktube-header-left">' +
          '<span class="yaktube-badge">\u26a1 Canl\u0131 YouTube & Web Arama</span>' +
          '<h2 class="yaktube-title-h3" style="margin:0; font-size:1.15rem;">Arama s\u0131ras\u0131nda bir ba\u011flant\u0131 sorunu olu\u015ftu.</h2>' +
          '</div>' +
          '</div>';
        announce('Arama s\u0131ras\u0131nda bir ba\u011flant\u0131 sorunu olu\u015ftu.');
      })
      .finally(function () {
        isSearching = false;
      });
  }

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // 8. FULL YOUTUBE SEARCH & VOICE MODAL ENGINE (v1.3.3 - Guaranteed Close Fix)
  // --------------------------------------------------------------------------
  var activeVoiceRec = null;
  var isVoiceListening = false;

  // Dynamic Search History & Trending Helpers
  function getRecentSearches() {
    try {
      var data = localStorage.getItem('yaktube_recent_searches');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecentSearch(query) {
    if (!query || query.trim().length < 2) return;
    var q = query.trim();
    try {
      var list = getRecentSearches();
      list = list.filter(function (item) {
        return item.toLowerCase() !== q.toLowerCase();
      });
      list.unshift(q);
      if (list.length > 8) list = list.slice(0, 8);
      localStorage.setItem('yaktube_recent_searches', JSON.stringify(list));
    } catch (e) {}
  }

  function clearRecentSearches() {
    try {
      localStorage.removeItem('yaktube_recent_searches');
    } catch (e) {}
    renderDynamicSearchChips();
    announce('Arama geçmişi temizlendi.');
  }

  var popularTrendingQueries = [
    { title: '🎵 Türkçe Pop', q: 'Türkçe Pop' },
    { title: '🎸 Anadolu Rock', q: 'Anadolu Rock' },
    { title: '🤖 Yapay Zeka', q: 'Yapay Zeka' },
    { title: '💻 Yazılım Dersleri', q: 'Yazılım Dersleri' },
    { title: '🎧 Sesli Kitap & Radyo Tiyatrosu', q: 'Sesli Kitap' },
    { title: '📺 Canlı Haber', q: 'Canlı Haber' },
    { title: '🌍 Bilim & Belgesel', q: 'Bilim Belgeseli' },
    { title: '🎼 Akustik Canlı Performans', q: 'Akustik Canlı' },
    { title: '🎙️ Podcast & Söyleşi', q: 'Podcast Türkçe' }
  ];

  function renderDynamicSearchChips() {
    var modal = document.getElementById('yaktube-full-search-modal');
    if (!modal) return;

    var container = modal.querySelector('#yaktube-modal-dynamic-chips-section');
    if (!container) return;

    var recent = getRecentSearches();
    var html = '';

    // 1. Recent searches section (if any)
    if (recent.length > 0) {
      html +=
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
        '<div class="yaktube-modal-section-title" style="margin-bottom: 0;">🕒 Son Aramalarınız</div>' +
        '<button id="yaktube-clear-recent-btn" style="background: transparent; border: none; color: #ff8f37; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: underline;" aria-label="Arama geçmişini temizle">Geçmişi Temizle</button>' +
        '</div>' +
        '<div class="yaktube-modal-chips-grid" style="margin-bottom: 18px;">';

      recent.forEach(function (term) {
        var safeTerm = term.replace(/"/g, '&quot;');
        html +=
          '<button class="yaktube-modal-chip yaktube-recent-chip" data-query="' +
          safeTerm +
          '" aria-label="Son arama: ' +
          safeTerm +
          '">🕒 ' +
          safeTerm +
          '</button>';
      });
      html += '</div>';
    }

    // 2. Popular & Trending searches section
    html +=
      '<div class="yaktube-modal-section-title">🔥 Hızlı ve Popüler Aramalar</div>' +
      '<div class="yaktube-modal-chips-grid">';

    popularTrendingQueries.forEach(function (item) {
      var safeQ = item.q.replace(/"/g, '&quot;');
      html +=
        '<button class="yaktube-modal-chip" data-query="' +
        safeQ +
        '" aria-label="Popüler arama: ' +
        safeQ +
        '">' +
        item.title +
        '</button>';
    });
    html += '</div>';

    container.innerHTML = html;

    // Attach click events
    container.querySelectorAll('.yaktube-modal-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var query = chip.getAttribute('data-query');
        var inp = modal.querySelector('#yaktube-modal-input');
        if (inp) inp.value = query;
        if (typeof window.__yaktube_execute_search__ === 'function') {
          window.__yaktube_execute_search__(query);
        }
      });
    });

    var clearBtn = container.querySelector('#yaktube-clear-recent-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        clearRecentSearches();
      });
    }
  }

  function createFullSearchModal() {
    var existingModal = document.getElementById('yaktube-full-search-modal');
    if (existingModal) return existingModal;

    var modal = document.createElement('div');
    modal.id = 'yaktube-full-search-modal';
    modal.className = 'yaktube-full-search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'yaktube-modal-search-title');

    modal.innerHTML =
      '<div class="yaktube-modal-search-card">' +
      '<div class="yaktube-modal-search-bar">' +
      '<button id="yaktube-modal-back-btn" class="yaktube-modal-back-btn" aria-label="Aramadan Çık (Escape)" title="Aramadan Çık (Escape)">←</button>' +
      '<div class="yaktube-modal-input-wrap">' +
      '<input id="yaktube-modal-input" type="search" placeholder="Video veya kanal ara..." aria-label="Arama Metni">' +
      '<button id="yaktube-modal-clear-btn" class="yaktube-modal-clear-btn" aria-label="Metni Temizle">✕</button>' +
      '</div>' +
      '<button id="yaktube-modal-submit-btn" class="yaktube-modal-search-action-btn" aria-label="Ara">🔍 Ara</button>' +
      '<button id="yaktube-modal-voice-btn" class="yaktube-modal-voice-btn" aria-label="Sesle Ara (Shift+V)" title="Sesle Ara">🎙️</button>' +
      '</div>' +
      '<div class="yaktube-modal-body">' +
      '<div id="yaktube-modal-voice-section" class="yaktube-modal-voice-section">' +
      '<div id="yaktube-modal-voice-status" class="yaktube-modal-voice-status">🎙️ Dinleniyor...</div>' +
      '<div id="yaktube-modal-voice-transcript" class="yaktube-modal-voice-transcript">Lütfen aramak istediğiniz videoyu söyleyin...</div>' +
      '<button id="yaktube-modal-mic-pulse" class="yaktube-modal-mic-pulse-btn" aria-label="Mikrofonu durdur">🎙️</button>' +
      '</div>' +
      '<div class="yaktube-modal-section-title">🔥 Hızlı ve Popüler Aramalar</div>' +
      '<div class="yaktube-modal-chips-grid">' +
      '<button class="yaktube-modal-chip" data-query="Tarkan">🎵 Tarkan</button>' +
      '<button class="yaktube-modal-chip" data-query="Barış Manço">🎸 Barış Manço</button>' +
      '<button class="yaktube-modal-chip" data-query="Python Dersleri">💻 Python Dersleri</button>' +
      '<button class="yaktube-modal-chip" data-query="Yapay Zeka">🤖 Yapay Zeka</button>' +
      '<button class="yaktube-modal-chip" data-query="Sesli Kitap">🎧 Sesli Kitap</button>' +
      '<button class="yaktube-modal-chip" data-query="Canlı Haber">📺 Canlı Haber</button>' +
      '<button class="yaktube-modal-chip" data-query="Gitar Dersi">🎼 Gitar Dersi</button>' +
      '<button class="yaktube-modal-chip" data-query="Bilim Belgeseli">🌍 Bilim Belgeseli</button>' +
      '</div>' +
      '<div class="yaktube-modal-hint-footer">' +
      '<span>💡 <b>Enter</b> ile ara, <b>Shift+V</b> ile sesli ara</span>' +
      '<span><b>Escape</b> ile kapat</span>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var inp = modal.querySelector('#yaktube-modal-input');
    var clearBtn = modal.querySelector('#yaktube-modal-clear-btn');
    var backBtn = modal.querySelector('#yaktube-modal-back-btn');
    var submitBtn = modal.querySelector('#yaktube-modal-submit-btn');
    var voiceBtn = modal.querySelector('#yaktube-modal-voice-btn');
    var micPulseBtn = modal.querySelector('#yaktube-modal-mic-pulse');

    // Input typing & clear
    inp.addEventListener('input', function () {
      if (inp.value && inp.value.trim().length > 0) {
        clearBtn.style.display = 'inline-flex';
      } else {
        clearBtn.style.display = 'none';
      }
    });

    clearBtn.addEventListener('click', function () {
      inp.value = '';
      clearBtn.style.display = 'none';
      inp.focus();
      announce('Arama metni temizlendi.');
    });

    // Close on Back button or Escape
    backBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeFullSearchModal();
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeFullSearchModal();
      }
    });

    // Search execute
    function executeSearch(query) {
      var q = (query || inp.value || '').trim();
      if (q) {
        saveRecentSearch(q);
        announce('"' + q + '" için arama yapılıyor...', true);
        closeFullSearchModal();
        window.location.href = '/search/videos?search=' + encodeURIComponent(q);
      }
    }
    window.__yaktube_execute_search__ = executeSearch;
    renderDynamicSearchChips();

    submitBtn.addEventListener('click', function () {
      executeSearch();
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFullSearchModal();
      }
    });

    // Chips click
    modal.querySelectorAll('.yaktube-modal-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var query = chip.getAttribute('data-query');
        executeSearch(query);
      });
    });

    // Voice button click
    voiceBtn.addEventListener('click', function () {
      toggleVoiceInsideModal();
    });

    micPulseBtn.addEventListener('click', function () {
      toggleVoiceInsideModal();
    });

    return modal;
  }

  function openFullSearchModal(initialQuery, autoStartVoice) {
    var modal = createFullSearchModal();
    modal.classList.add('yaktube-modal-open');
    modal.style.display = 'flex';
    renderDynamicSearchChips();

    var inp = modal.querySelector('#yaktube-modal-input');
    var clearBtn = modal.querySelector('#yaktube-modal-clear-btn');
    if (inp) {
      inp.value = initialQuery || '';
      if (inp.value) clearBtn.style.display = 'inline-flex';
      setTimeout(function () {
        inp.focus();
        inp.select();
      }, 50);
    }

    announce('Arama penceresi açıldı. Arayacağınız konuyu yazın veya sesle arayın.', true);

    if (autoStartVoice) {
      startVoiceInsideModal();
    }
  }

  function closeFullSearchModal() {
    var modal = document.getElementById('yaktube-full-search-modal');
    if (modal) {
      modal.classList.remove('yaktube-modal-open');
      modal.style.display = 'none';
    }
    stopVoiceInsideModal();
    announce('Arama penceresi kapatıldı.');

    var trigger = document.querySelector('.yaktube-search-trigger-pill');
    if (trigger) {
      try {
        trigger.focus();
      } catch (e) {}
    }
  }

  function toggleVoiceInsideModal() {
    if (isVoiceListening) {
      stopVoiceInsideModal();
    } else {
      startVoiceInsideModal();
    }
  }

  function startVoiceInsideModal() {
    var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var modal = document.getElementById('yaktube-full-search-modal');
    if (!modal) return;

    var voiceSec = modal.querySelector('#yaktube-modal-voice-section');
    var statusText = modal.querySelector('#yaktube-modal-voice-status');
    var transcriptEl = modal.querySelector('#yaktube-modal-voice-transcript');
    var inp = modal.querySelector('#yaktube-modal-input');

    if (voiceSec) voiceSec.style.display = 'block';
    if (statusText) statusText.textContent = '🎙️ Dinleniyor...';
    if (transcriptEl) transcriptEl.textContent = 'Lütfen aramak istediğiniz videoyu söyleyin...';

    if (!SpeechRec) {
      if (statusText) statusText.textContent = 'Tarayıcıda Ses Tanıma Desteklenmiyor';
      if (transcriptEl) transcriptEl.textContent = 'Lütfen Google Chrome veya Microsoft Edge kullanın.';
      announce('Tarayıcınız ses tanımayı desteklemiyor. Lütfen Chrome veya Edge kullanın.');
      return;
    }

    announce('Sesli arama dinleniyor, lütfen aramak istediğiniz videoyu söyleyin.', true);

    try {
      activeVoiceRec = new SpeechRec();
      activeVoiceRec.lang = navigator.language || 'tr-TR';
      activeVoiceRec.continuous = false;
      activeVoiceRec.interimResults = true;
      activeVoiceRec.maxAlternatives = 1;

      isVoiceListening = true;

      activeVoiceRec.onresult = function (ev) {
        if (ev.results && ev.results[0]) {
          var transcript = ev.results[0][0].transcript.trim();
          if (transcriptEl) transcriptEl.textContent = '"' + transcript + '"';
          if (inp) inp.value = transcript;

          if (ev.results[0].isFinal) {
            announce('"' + transcript + '" için arama başlatılıyor...', true);
            setTimeout(function () {
              closeFullSearchModal();
              window.location.href = '/search/videos?search=' + encodeURIComponent(transcript);
            }, 500);
          }
        }
      };

      activeVoiceRec.onerror = function (ev) {
        if (statusText) statusText.textContent = 'Ses Algılanamadı';
        if (transcriptEl) transcriptEl.textContent = 'Tekrar denemek için mikrofona dokunun.';
        stopVoiceInsideModal();
      };

      activeVoiceRec.onend = function () {
        stopVoiceInsideModal();
      };

      activeVoiceRec.start();
    } catch (err) {
      stopVoiceInsideModal();
    }
  }

  function stopVoiceInsideModal() {
    isVoiceListening = false;
    if (activeVoiceRec) {
      try {
        activeVoiceRec.stop();
      } catch (e) {}
      activeVoiceRec = null;
    }
    var modal = document.getElementById('yaktube-full-search-modal');
    if (modal) {
      var voiceSec = modal.querySelector('#yaktube-modal-voice-section');
      if (voiceSec) voiceSec.style.display = 'none';
    }
  }

  function transformToYouTubeSearchBar(searchInp, searchContainer) {
    if (searchContainer.hasAttribute('data-yaktube-trigger-styled')) return;
    searchContainer.setAttribute('data-yaktube-trigger-styled', 'true');

    // Hide original native inputs
    searchInp.style.display = 'none';
    searchInp.setAttribute('tabindex', '-1');
    searchInp.setAttribute('aria-hidden', 'true');

    var nativeInputs = searchContainer.querySelectorAll('input, button');
    nativeInputs.forEach(function (el) {
      if (!el.classList.contains('yaktube-search-trigger-pill') && !el.classList.contains('yaktube-voice-search-btn')) {
        el.style.display = 'none';
        el.setAttribute('tabindex', '-1');
        el.setAttribute('aria-hidden', 'true');
      }
    });

    // 1. Create Outer Wrapper
    var outerWrap = searchContainer.querySelector('.yaktube-search-outer-wrap');
    if (!outerWrap) {
      outerWrap = document.createElement('div');
      outerWrap.className = 'yaktube-search-outer-wrap';
      searchContainer.appendChild(outerWrap);
    }

    // 2. Create Single Sleek Pill Trigger
    var triggerPill = outerWrap.querySelector('.yaktube-search-trigger-pill');
    if (!triggerPill) {
      triggerPill = document.createElement('button');
      triggerPill.type = 'button';
      triggerPill.className = 'yaktube-search-trigger-pill';
      triggerPill.setAttribute('aria-label', 'Ara');
      triggerPill.setAttribute('title', 'Arama Yap (/)');

      triggerPill.innerHTML =
        '<span class="yaktube-search-trigger-icon">🔍</span>' +
        '<span class="yaktube-search-trigger-text">Ara...</span>' +
        '<span class="yaktube-search-trigger-shortcut">/</span>';

      outerWrap.appendChild(triggerPill);

      triggerPill.addEventListener('click', function (e) {
        e.preventDefault();
        openFullSearchModal('', false);
      });
    }

    // 3. YouTube Circular Voice Button (🎙️) Beside the Pill Box
    var voiceBtn = outerWrap.querySelector('.yaktube-voice-search-btn');
    if (!voiceBtn) {
      voiceBtn = document.createElement('button');
      voiceBtn.type = 'button';
      voiceBtn.className = 'yaktube-voice-search-btn';
      voiceBtn.setAttribute('aria-label', 'Sesle Ara (Shift+V)');
      voiceBtn.setAttribute('title', 'Sesle Ara (Shift+V)');
      voiceBtn.innerHTML = '🎙️';

      outerWrap.appendChild(voiceBtn);

      voiceBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openFullSearchModal('', true);
      });
    }
  }

  function injectSearchEnhancements() {
    var searchContainers = document.querySelectorAll(
      'my-search-typeahead, .search-container, .header-search, my-header .search'
    );
    searchContainers.forEach(function (container) {
      var searchInp = container.querySelector('input[type="search"], input[type="text"], input');
      if (searchInp) {
        transformToYouTubeSearchBar(searchInp, container);
      }
    });

    // Clean up repetitive card titles and strange relative date buttons
    document.querySelectorAll('my-video-miniature, .video-miniature').forEach(function (card) {
      var thumbLink = card.querySelector('a.thumbnail-link, .video-thumbnail a, a.thumbnail');
      if (thumbLink && !thumbLink.hasAttribute('aria-hidden')) {
        thumbLink.setAttribute('aria-hidden', 'true');
        thumbLink.setAttribute('tabindex', '-1');
      }

      var dateBtn = card.querySelector('.video-date-line button, .video-date button, button[title*="tarih"]');
      if (dateBtn && !dateBtn.hasAttribute('data-cleaned')) {
        dateBtn.setAttribute('data-cleaned', 'true');
        var dateText = dateBtn.textContent.trim();
        dateBtn.setAttribute('aria-label', dateText);
      }
    });
  }

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', function (e) {
    var activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    var isInputActive = activeTag === 'input' || activeTag === 'textarea';

    // Shift + V: Open YouTube Voice Search Modal
    if (e.shiftKey && (e.key === 'V' || e.key === 'v') && !isInputActive) {
      e.preventDefault();
      openFullSearchModal('', true);
    }
    // Escape: Close Full Search Modal
    else if (e.key === 'Escape' || e.keyCode === 27) {
      var modal = document.getElementById('yaktube-full-search-modal');
      if (modal && modal.classList.contains('yaktube-modal-open')) {
        e.preventDefault();
        closeFullSearchModal();
      }
    }
    // / or S: Open Search Modal
    else if ((e.key === '/' || e.key === 's' || e.key === 'S') && !isInputActive && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openFullSearchModal('', false);
    }
  });

  // 7.5. Reactive Hybrid Related Videos Engine (Watch Page)
  var currentActiveVideoKey = null;
  var isFetchingRelated = false;
  var relatedShowAll = false;
  var cachedRelatedResults = [];
  var cachedRelatedQuery = '';

  function renderRelatedCards(container, results, query) {
    var count = results ? results.length : 0;
    if (count === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    var limit = relatedShowAll ? count : Math.min(count, 12);
    var displayed = results.slice(0, limit);

    var cardsHtml = '';
    displayed.forEach(function (item) {
      var isLocal = !!item.isDownloaded;
      var statusBadge = isLocal
        ? '<span class="yaktube-badge" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); margin-bottom: 4px; display: inline-block; font-size:10px; padding:2px 8px;">✅ ' +
          getInstanceName() +
          "'da İzle</span>"
        : '<span class="yaktube-badge" style="background: linear-gradient(135deg, #ff8f37 0%, #ff5e3a 100%); margin-bottom: 4px; display: inline-block; font-size:10px; padding:2px 8px;">⚡ Canlı Keşif</span>';

      var actionButton = isLocal
        ? '<a href="' +
          item.localVideo.url +
          '" class="yaktube-play-btn yaktube-related-play-link" style="font-size:11px; padding:6px 10px;" aria-label="' +
          item.title.replace(/"/g, '&quot;') +
          ' videosunu YakTube\'dan hemen izle">▶️ Hemen İzle</a>'
        : '<button class="yaktube-import-btn yaktube-related-import" data-url="' +
          item.url +
          '" data-title="' +
          item.title.replace(/"/g, '&quot;') +
          '" style="font-size:11px; padding:6px 10px;" aria-label="' +
          item.title.replace(/"/g, '&quot;') +
          ' videosunu ' +
          getInstanceName() +
          '\'a indir ve izle">📥 İndir ve İzle</button>';

      var cardLabel =
        item.title +
        (isLocal ? ' (' + getInstanceName() + ' kütüphanenizde mevcut)' : ' (Canlı YouTube keşfi)') +
        ', ' +
        item.channel +
        ' kanalı, Süre: ' +
        item.durationFormatted;
      cardsHtml +=
        '<div class="yaktube-card" role="article" tabindex="0" style="margin-bottom:10px;" aria-label="' +
        cardLabel.replace(/"/g, '&quot;') +
        '">' +
        '<div class="yaktube-thumb-wrap">' +
        '<img class="yaktube-thumb-img" src="' +
        item.thumbnail +
        '" alt="' +
        item.title.replace(/"/g, '&quot;') +
        '" loading="lazy" />' +
        '<span class="yaktube-duration-badge" aria-label="Süre">' +
        item.durationFormatted +
        '</span>' +
        '</div>' +
        '<div class="yaktube-info">' +
        '<div>' +
        statusBadge +
        '<h4 class="yaktube-video-name" title="' +
        item.title +
        '" style="margin:0; font-size:12px; font-weight:600; line-height:1.35;">' +
        item.title +
        '</h4>' +
        '<div class="yaktube-channel-name" style="font-size:10px;">' +
        item.channel +
        '</div>' +
        '</div>' +
        actionButton +
        '</div>' +
        '</div>';
    });

    var loadMoreBtn = '';
    if (count > 12) {
      if (!relatedShowAll) {
        loadMoreBtn =
          '<button id="yaktube-related-toggle-more" class="yaktube-shortcuts-btn" style="width:100%; margin-top:12px; padding:10px; justify-content:center; font-weight:700; background:rgba(255,143,55,0.15); border-color:#ff8f37; color:#fff;" aria-label="Daha fazla önerilen video göster">' +
          '➕ Daha Fazla Öneri Göster (' +
          (count - 12) +
          ' video daha)' +
          '</button>';
      } else {
        loadMoreBtn =
          '<button id="yaktube-related-toggle-more" class="yaktube-shortcuts-btn" style="width:100%; margin-top:12px; padding:8px; justify-content:center; font-size:11px;" aria-label="Daha az öneri göster">' +
          '🔼 Daha Az Göster' +
          '</button>';
      }
    }

    var headerCountText = count > 12 && !relatedShowAll ? displayed.length + ' / ' + count : count;

    container.innerHTML =
      '<div class="yaktube-header">' +
      '<div class="yaktube-header-left">' +
      '<span class="yaktube-badge">🔥 ' +
      getInstanceName() +
      ' Akıllı Önerilenler</span>' +
      '<h3 class="yaktube-title-h3" style="margin:0; font-size:1.05rem;">"' +
      query +
      '" ile İlgili Öneriler (' +
      headerCountText +
      ')</h3>' +
      '</div>' +
      '<button id="yaktube-related-refresh-btn" class="yaktube-shortcuts-btn" aria-label="Önerileri Yenile">' +
      '🔄 Yenile' +
      '</button>' +
      '</div>' +
      '<div class="yaktube-grid" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px;">' +
      cardsHtml +
      '</div>' +
      loadMoreBtn;

    var toggleBtn = document.getElementById('yaktube-related-toggle-more');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        relatedShowAll = !relatedShowAll;
        renderRelatedCards(container, cachedRelatedResults, cachedRelatedQuery);
        announce(
          relatedShowAll ? 'Tüm ' + cachedRelatedResults.length + ' önerilen video açıldı.' : 'Öneriler daraltıldı.'
        );
      });
    }

    var refreshBtn = document.getElementById('yaktube-related-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        currentActiveVideoKey = null;
        checkAndInjectRelatedVideos(true);
      });
    }

    container.querySelectorAll('.yaktube-related-import').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var videoUrl = e.currentTarget.getAttribute('data-url');
        var videoTitle = e.currentTarget.getAttribute('data-title');
        handleImport(videoUrl, e.currentTarget, videoTitle);
      });
    });

    container.querySelectorAll('.yaktube-related-play-link').forEach(function (link) {
      link.addEventListener('click', function () {
        currentActiveVideoKey = null;
      });
    });
  }

  function checkAndInjectRelatedVideos(forceReload) {
    var isWatchPage = window.location.pathname.includes('/videos/watch/') || window.location.pathname.startsWith('/w/');
    if (!isWatchPage) {
      var existing = document.getElementById('yaktube-hybrid-related-container');
      if (existing) existing.remove();
      currentActiveVideoKey = null;
      return;
    }

    var titleElem =
      document.querySelector('h1.video-name') ||
      document.querySelector('.video-info h1') ||
      document.querySelector('.video-watch-heading h1') ||
      document.querySelector('h1') ||
      document.querySelector('.title');

    var rawTitle = titleElem ? (titleElem.textContent || titleElem.innerText || '').trim() : '';
    if (!rawTitle || rawTitle.length < 3) {
      return;
    }

    var currentPath = window.location.pathname;
    var thisVideoKey = currentPath + '::' + rawTitle.toLowerCase();

    if (
      !forceReload &&
      thisVideoKey === currentActiveVideoKey &&
      document.getElementById('yaktube-hybrid-related-container')
    ) {
      return;
    }

    if (isFetchingRelated) return;
    isFetchingRelated = true;

    var cleanTopic = rawTitle
      .replace(/YakTube/gi, '')
      .replace(/[\(\[].*?[\)\]]/g, '')
      .replace(/official video|video klip|klip|hd|4k|lyric video|audio|remix|feat\.?|ft\.?/gi, '')
      .trim();

    var words = cleanTopic.split(/\s+/).filter(function (w) {
      return w.length > 2;
    });
    var searchQuery = words.slice(0, 3).join(' ') || cleanTopic;

    var container = document.getElementById('yaktube-hybrid-related-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'yaktube-hybrid-related-container';
      container.className = 'yaktube-ondemand-section';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'YakTube Akıllı Önerilen Videolar');
    }

    var recVideosMount = document.querySelector('my-recommended-videos, .other-videos');
    var commentsMount = document.querySelector('#yaktube-watch-comments-panel, my-video-comments, .video-comments');
    var videoBottomMount = document.querySelector('.video-bottom, .video-info');
    var watchMount = document.querySelector('my-video-watch') || document.querySelector('main');

    if (recVideosMount) {
      if (container.parentElement !== recVideosMount) {
        recVideosMount.prepend(container);
      }
    } else if (commentsMount) {
      if (container.previousElementSibling !== commentsMount) {
        commentsMount.insertAdjacentElement('afterend', container);
      }
    } else if (videoBottomMount) {
      if (container.previousElementSibling !== videoBottomMount) {
        videoBottomMount.insertAdjacentElement('afterend', container);
      }
    } else if (watchMount) {
      if (container.parentElement !== watchMount) {
        watchMount.appendChild(container);
      }
    } else {
      isFetchingRelated = false;
      return;
    }

    container.innerHTML =
      '<div class="yaktube-header">' +
      '<div class="yaktube-header-left">' +
      '<span class="yaktube-badge">🔥 ' +
      getInstanceName() +
      ' Akıllı Önerilenler</span>' +
      '<h3 class="yaktube-title-h3" style="margin:0; font-size:1.05rem;">"' +
      searchQuery +
      '" için Öneriler Taranıyor...</h3>' +
      '</div>' +
      '</div>' +
      '<div style="padding: 18px; text-align: center; color: #ff8f37;">' +
      '<div class="yaktube-spinner" style="width: 30px; height: 30px; border-width: 3px;" aria-hidden="true"></div>' +
      '<div style="margin-top: 10px; font-size: 13px;">YouTube ve Fediverse\'deki en alakalı videolar getiriliyor...</div>' +
      '</div>';

    announce(searchQuery + ' için ilgili video önerileri yükleniyor.');

    fetch('/api-custom/youtube-search?q=' + encodeURIComponent(searchQuery))
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var rawResults = data.results || [];
        var normalizedCurrentTitle = rawTitle.toLowerCase().trim();

        var uniqueResults = [];
        var seenIds = {};

        rawResults.forEach(function (item) {
          if (item && item.id && !seenIds[item.id] && item.title) {
            var itemTitle = item.title.toLowerCase().trim();
            if (itemTitle !== normalizedCurrentTitle && !itemTitle.includes(normalizedCurrentTitle)) {
              seenIds[item.id] = true;
              uniqueResults.push(item);
            }
          }
        });

        cachedRelatedResults = uniqueResults;
        cachedRelatedQuery = searchQuery;
        currentActiveVideoKey = thisVideoKey;
        relatedShowAll = false;

        renderRelatedCards(container, uniqueResults, searchQuery);

        var initialCount = Math.min(uniqueResults.length, 12);
        if (uniqueResults.length === 0) {
          announce(searchQuery + ' için ilgili öneri bulunamadı.');
        } else {
          announce(
            searchQuery +
              ' için ' +
              initialCount +
              ' öneri gösteriliyor' +
              (uniqueResults.length > 12 ? ', toplam ' + uniqueResults.length + ' video bulundu' : '') +
              '.'
          );
        }
      })
      .catch(function (err) {
        console.error('[YakTube] Related fetch error:', err);
        container.style.display = 'none';
      })
      .finally(function () {
        isFetchingRelated = false;
      });
  }

  var lastWatchUuid = null;

  function checkAndInjectWatchPageComments() {
    var pathname = window.location.pathname;
    var match = pathname.match(/\/videos\/watch\/([a-zA-Z0-9_-]+)/) || pathname.match(/\/w\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      lastWatchUuid = null;
      var existingWatchComments = document.getElementById('yaktube-watch-comments-panel');
      if (existingWatchComments) existingWatchComments.remove();
      return;
    }

    var uuid = match[1];
    var existingPanel = document.getElementById('yaktube-watch-comments-panel');
    if (uuid === lastWatchUuid && existingPanel) {
      var nativeComments = document.querySelector('my-video-comments, .video-comments, .comments-block, #comments');
      if (nativeComments && existingPanel.previousElementSibling !== nativeComments) {
        nativeComments.insertAdjacentElement('afterend', existingPanel);
      }
      return;
    }
    lastWatchUuid = uuid;

    var mountTarget =
      document.querySelector('my-video-comments, .video-comments, my-video-watch, .video-bottom') || document.body;
    if (!mountTarget) return;

    fetch('/api-custom/video-origin/' + encodeURIComponent(uuid))
      .then(function (r) {
        return r.json();
      })
      .then(function (originData) {
        if (!originData || !originData.ok || !originData.hasYouTubeOrigin || !originData.youtubeId) {
          var old = document.getElementById('yaktube-watch-comments-panel');
          if (old) old.remove();
          return;
        }

        var youtubeId = originData.youtubeId;
        var existing = document.getElementById('yaktube-watch-comments-panel');
        if (existing) existing.remove();

        var panel = document.createElement('div');
        panel.id = 'yaktube-watch-comments-panel';
        panel.className = 'yaktube-comments-panel';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'YouTube Orijinal Yorumlar\u0131');
        panel.style.cssText =
          'margin-top: 24px; margin-bottom: 24px; background: #0f172a; border-radius: 12px; padding: 20px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 8px 24px rgba(0,0,0,0.4);';

        panel.innerHTML =
          '<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">' +
          '<div>' +
          '<h2 style="margin: 0; font-size: 16px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">' +
          "\ud83d\udcac YouTube'daki Orijinal Yorumlar" +
          '</h2>' +
          '<div style="color: #94a3b8; font-size: 12px; margin-top: 4px;">Bu video YouTube\'dan aktar\u0131lm\u0131\u015ft\u0131r. Orijinal topluluk yorumlar\u0131n\u0131 a\u015fa\u011f\u0131dan anl\u0131k olarak y\u00fckleyebilirsiniz.</div>' +
          '</div>' +
          '<button id="yaktube-watch-toggle-comments-btn" style="background: #ff8f37; color: #000; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(255,143,55,0.3);" aria-label="YouTube yorumlar\u0131n\u0131 y\u00fckle ve g\u00f6ster">' +
          '\ud83d\udcac Yorumlar\u0131 G\u00f6ster (20 Yorum)' +
          '</button>' +
          '</div>' +
          '<div id="yaktube-watch-comments-list" style="display: none; margin-top: 16px; flex-direction: column; gap: 12px;"></div>' +
          '<div id="yaktube-watch-more-comments-wrap" style="text-align: center; margin-top: 18px; display: none;">' +
          '<button id="yaktube-watch-more-comments-btn" style="background: #1e293b; color: #ff8f37; border: 1px solid #ff8f37; padding: 10px 24px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s ease;" aria-label="Daha fazla YouTube yorumu y\u00fckle">' +
          '\u2795 Daha Fazla Yorum G\u00f6ster (+20 Yorum)' +
          '</button>' +
          '</div>';

        var nativeComments = document.querySelector('my-video-comments, .video-comments, .comments-block, #comments');
        if (nativeComments && nativeComments.parentElement) {
          nativeComments.insertAdjacentElement('afterend', panel);
        } else {
          var watchCol = document.querySelector('.video-info, .video-bottom, my-video-watch, .main-col');
          if (watchCol) {
            watchCol.appendChild(panel);
          } else {
            mountTarget.appendChild(panel);
          }
        }

        var watchCommentToken = null;
        var listContainer = document.getElementById('yaktube-watch-comments-list');
        var toggleBtn = document.getElementById('yaktube-watch-toggle-comments-btn');
        var moreWrap = document.getElementById('yaktube-watch-more-comments-wrap');
        var moreBtn = document.getElementById('yaktube-watch-more-comments-btn');

        function fetchWatchComments(token) {
          if (!token) {
            toggleBtn.disabled = true;
            toggleBtn.textContent = '⏳ Yorumlar Y\u00fckleniyor...';
          } else {
            moreBtn.disabled = true;
            moreBtn.textContent = '⏳ Y\u00fckleniyor...';
          }

          var fUrl =
            '/api-custom/youtube-comments?id=' +
            encodeURIComponent(youtubeId) +
            (token ? '&token=' + encodeURIComponent(token) : '');
          fetch(fUrl)
            .then(function (r) {
              return r.json();
            })
            .then(function (res) {
              if (!token) {
                listContainer.innerHTML = '';
                listContainer.style.display = 'flex';
                toggleBtn.textContent = '🔄 Yorumlar\u0131 Yenile';
                toggleBtn.disabled = false;
              } else {
                moreBtn.textContent = '➕ Daha Fazla Yorum G\u00f6ster (+20 Yorum)';
                moreBtn.disabled = false;
              }

              var cList = res.comments || [];
              if (cList.length === 0 && !token) {
                listContainer.innerHTML =
                  '<div style="color: #94a3b8; font-size: 13px; text-align: center; padding: 12px;">Bu videoda hen\u00fcz YouTube yorumu bulunmuyor.</div>';
                moreWrap.style.display = 'none';
                announce('Bu videoda henüz YouTube yorumu bulunmuyor.');
                return;
              }

              cList.forEach(function (c) {
                var card = document.createElement('div');
                card.className = 'yaktube-comment-item';
                card.setAttribute('role', 'article');
                card.setAttribute('tabindex', '0');
                card.setAttribute('aria-label', c.author + ' isimli kullan\u0131c\u0131n\u0131n yorumu: ' + c.content);
                card.style.cssText =
                  'background: #1e293b; padding: 14px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); display: flex; gap: 12px; align-items: flex-start;';

                var avatarLetter = (c.author || 'U').replace('@', '').charAt(0).toUpperCase();
                var avatarHtml =
                  '<div style="width: 38px; height: 38px; border-radius: 50%; background: #334155; color: #ff8f37; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;">' +
                  avatarLetter +
                  '</div>';
                var safeContent = c.content
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\n/g, '<br>');

                card.innerHTML =
                  avatarHtml +
                  '<div style="flex-grow: 1; min-width: 0;">' +
                  '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">' +
                  '<h3 class="yaktube-comment-author-heading" style="margin: 0; font-size: 13px; font-weight: 700; color: #f1f5f9; display: inline-block;">' +
                  c.author +
                  '</h3>' +
                  '<span style="color: #64748b; font-size: 11px;">' +
                  c.published +
                  '</span>' +
                  (c.likeCount && c.likeCount !== '0'
                    ? '<span style="background: rgba(255,255,255,0.08); color: #94a3b8; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">👍 ' +
                      c.likeCount +
                      '</span>'
                    : '') +
                  '</div>' +
                  '<div style="color: #cbd5e1; font-size: 13px; line-height: 1.5; word-break: break-word;">' +
                  safeContent +
                  '</div>' +
                  '</div>';

                listContainer.appendChild(card);
              });

              watchCommentToken = res.nextToken;
              if (watchCommentToken) {
                moreWrap.style.display = 'block';
              } else {
                moreWrap.style.display = 'none';
              }

              announce(cList.length + ' adet YouTube yorumu y\u00fcklendi.');
            })
            .catch(function (err) {
              if (!token) {
                toggleBtn.disabled = false;
                toggleBtn.textContent = '⚠️ Tekrar Dene';
              } else {
                moreBtn.disabled = false;
                moreBtn.textContent = '⚠️ Tekrar Dene';
              }
              alert('Yorumlar y\u00fcklenirken hata olu\u015ftu: ' + err.message);
            });
        }

        if (toggleBtn) {
          toggleBtn.addEventListener('click', function () {
            fetchWatchComments(null);
          });
        }
        if (moreBtn) {
          moreBtn.addEventListener('click', function () {
            if (watchCommentToken) fetchWatchComments(watchCommentToken);
          });
        }
      })
      .catch(function () {});
  }

  // 6. PWA Mobile App Install Engine & Standalone Detection
  var isInsideYakTubeApp =
    navigator.userAgent.indexOf('YakTubeMobileApp') !== -1 ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  var isMobileDevice = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent);

  var deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    if (isInsideYakTubeApp) return;
    e.preventDefault();
    deferredInstallPrompt = e;
    injectPWAInstallButton();
  });

  function injectPWAInstallButton() {
    if (isInsideYakTubeApp) {
      var existBtn = document.getElementById('yaktube-pwa-install-btn');
      if (existBtn) {
        existBtn.setAttribute('aria-hidden', 'true');
        existBtn.remove();
      }
      return;
    }
    if (!deferredInstallPrompt || document.getElementById('yaktube-pwa-install-btn')) return;

    var headerButtons =
      document.querySelector('my-header .buttons-container') ||
      document.querySelector('.buttons-container') ||
      document.querySelector('my-header');
    if (!headerButtons) return;

    var installBtn = document.createElement('button');
    installBtn.id = 'yaktube-pwa-install-btn';
    installBtn.className = 'yaktube-pwa-btn';
    installBtn.setAttribute('type', 'button');
    installBtn.setAttribute('aria-label', 'YakTube Mobil Uygulamasını Yükle');
    installBtn.style.cssText =
      'background: linear-gradient(135deg, #ff8f37, #f97316); color: #000; border: none; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; box-shadow: 0 4px 12px rgba(255,143,55,0.4);';
    installBtn.innerHTML = '📲 Uygulamayı Yükle';

    installBtn.addEventListener('click', function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function (choiceResult) {
          if (choiceResult.outcome === 'accepted') {
            installBtn.remove();
            announce('YakTube uygulaması cihazınıza yükleniyor.');
          }
          deferredInstallPrompt = null;
        });
      }
    });

    headerButtons.prepend(installBtn);
  }

  function injectApkDownloadButton() {
    // 1. If inside APK: NEVER show APK button
    if (isInsideYakTubeApp) {
      var existBtnApp = document.getElementById('yaktube-apk-download-btn');
      if (existBtnApp) {
        existBtnApp.setAttribute('aria-hidden', 'true');
        existBtnApp.remove();
      }
      return;
    }

    // 2. If on Desktop: NEVER show in top header (keep header clean)
    if (!isMobileDevice) {
      var existBtnDesktop = document.getElementById('yaktube-apk-download-btn');
      if (existBtnDesktop) {
        existBtnDesktop.setAttribute('aria-hidden', 'true');
        existBtnDesktop.remove();
      }
      return;
    }

    // 3. If on Mobile Web: Show in header
    if (document.getElementById('yaktube-apk-download-btn')) return;

    var headerButtons =
      document.querySelector('my-header .buttons-container') ||
      document.querySelector('my-header .header-right') ||
      document.querySelector('.buttons-container') ||
      document.querySelector('my-header');
    if (!headerButtons) return;

    var apkBtn = document.createElement('a');
    apkBtn.id = 'yaktube-apk-download-btn';
    apkBtn.href = '/yaktube.apk';
    apkBtn.className = 'yaktube-apk-btn';
    apkBtn.setAttribute('download', 'YakTube_Mobile_v1.0.apk');
    apkBtn.setAttribute('aria-label', 'YakTube Android APK İndir (4.5 MB)');
    apkBtn.style.cssText =
      'background: #1e293b; color: #ff8f37; border: 1px solid #ff8f37; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 11px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
    apkBtn.innerHTML = '🤖 APK İndir (4.5 MB)';

    headerButtons.prepend(apkBtn);
  }

  function injectSidebarApkLink() {
    // If inside APK: NEVER show in sidebar
    if (isInsideYakTubeApp) {
      var existLink = document.getElementById('yaktube-sidebar-apk-link');
      if (existLink) {
        existLink.setAttribute('aria-hidden', 'true');
        existLink.remove();
      }
      return;
    }

    if (document.getElementById('yaktube-sidebar-apk-link')) return;

    var menuContainer = document.querySelector('my-menu, .menu, .main-menu, .nav-list');
    if (!menuContainer) return;

    var sidebarLink = document.createElement('a');
    sidebarLink.id = 'yaktube-sidebar-apk-link';
    sidebarLink.href = '/yaktube.apk';
    sidebarLink.className = 'menu-link item-link';
    sidebarLink.setAttribute('download', 'YakTube_Mobile_v1.0.apk');
    sidebarLink.setAttribute('aria-label', 'YakTube Android Uygulamasını İndir (4.5 MB)');
    sidebarLink.style.cssText =
      'display: flex; align-items: center; gap: 10px; padding: 10px 16px; margin: 8px 12px; background: rgba(255, 143, 55, 0.1); color: #ff8f37; border: 1px solid rgba(255, 143, 55, 0.3); border-radius: 8px; font-weight: 700; font-size: 13px; text-decoration: none;';
    sidebarLink.innerHTML = '<span>🤖</span> <span>YakTube Android APK (4.5 MB)</span>';

    menuContainer.appendChild(sidebarLink);
  }

  setInterval(function () {
    checkAndInjectSearchResults();
    injectSearchEnhancements();
    checkAndInjectRelatedVideos(false);
    restoreActiveLiveStream();
    checkAndInjectWatchPageComments();
    injectPWAInstallButton();
    injectApkDownloadButton();
    injectSidebarApkLink();
  }, 800);
  restoreActiveLiveStream();
  window.addEventListener('popstate', function () {
    currentActiveVideoKey = null;
    checkAndInjectSearchResults();
    checkAndInjectRelatedVideos(true);
    checkAndInjectWatchPageComments();
  });
  checkAndInjectWatchPageComments();
})();

// 5. Background Play (Screen-Off / Minimize) & MediaSession Lock-Screen Controls
(function initBackgroundPlaybackEngine() {
  var videoState = {
    hasPlayed: false,
    pausedByUser: false,
    pausedAt: null
  };

  function attachVideoListeners(video) {
    if (!video || video.hasAttribute('data-yaktube-bgplay-hooked')) return;
    video.setAttribute('data-yaktube-bgplay-hooked', 'true');

    video.addEventListener('play', function () {
      videoState.hasPlayed = true;
      videoState.pausedByUser = false;
      updateMediaSessionMetadata(video);
    });

    video.addEventListener('pause', function () {
      videoState.pausedAt = Date.now();
      // If document is visible when paused, it was paused manually by the user
      if (!document.hidden) {
        videoState.pausedByUser = true;
      }
    });

    video.addEventListener('ended', function () {
      videoState.hasPlayed = false;
      videoState.pausedByUser = true;
    });

    video.addEventListener('timeupdate', function () {
      updateMediaSessionPosition(video);
    });
  }

  function handleVisibilityChange() {
    if (!document.hidden) return; // Screen is active

    var video = getVideoElement();
    if (!video) return;

    // If user hasn't played or deliberately paused, do not auto-resume
    if (!videoState.hasPlayed || videoState.pausedByUser) return;

    var now = Date.now();
    if (videoState.pausedAt && now - videoState.pausedAt > 1500 && videoState.pausedByUser) {
      return;
    }

    // Resume playback when screen locks or tab switches
    setTimeout(function () {
      if (video.paused && !videoState.pausedByUser) {
        video.play().catch(function () {});
      }
    }, 50);
  }

  document.addEventListener('visibilitychange', handleVisibilityChange, false);
  document.addEventListener('webkitvisibilitychange', handleVisibilityChange, false);

  // MediaSession API Integration (Lock Screen, Bluetooth, Smart Watches)
  function updateMediaSessionMetadata(video) {
    if (!('mediaSession' in navigator)) return;

    var titleEl = document.querySelector('h1.video-title, .video-name, my-video-watch h1, .title');
    var title = titleEl ? titleEl.textContent.trim() : 'YakTube Video';
    var authorEl = document.querySelector('.actor-name, .channel-name, .video-channel-name, a.actor-link');
    var artist = authorEl ? authorEl.textContent.trim() : 'YakTube';

    var artwork = [];
    var thumbEl = document.querySelector('meta[property="og:image"]');
    if (thumbEl && thumbEl.content) {
      artwork.push({ src: thumbEl.content, sizes: '512x512', type: 'image/jpeg' });
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: artist,
        album: 'YakTube',
        artwork: artwork
      });

      navigator.mediaSession.setActionHandler('play', function () {
        video.play();
        announce('Video oynatılıyor.');
      });
      navigator.mediaSession.setActionHandler('pause', function () {
        videoState.pausedByUser = true;
        video.pause();
        announce('Video duraklatıldı.');
      });
      navigator.mediaSession.setActionHandler('seekbackward', function (details) {
        var skipTime = details.seekOffset || 10;
        video.currentTime = Math.max(0, video.currentTime - skipTime);
        announce(skipTime + ' saniye geri sarıldı.');
      });
      navigator.mediaSession.setActionHandler('seekforward', function (details) {
        var skipTime = details.seekOffset || 10;
        video.currentTime = Math.min(video.duration || 99999, video.currentTime + skipTime);
        announce(skipTime + ' saniye ileri sarıldı.');
      });
      navigator.mediaSession.setActionHandler('stop', function () {
        videoState.pausedByUser = true;
        video.pause();
      });
    } catch (e) {}
  }

  function updateMediaSessionPosition(video) {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (isNaN(video.duration) || isNaN(video.currentTime) || video.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: video.duration,
        playbackRate: video.playbackRate || 1,
        position: Math.min(video.currentTime, video.duration)
      });
    } catch (e) {}
  }

  // Auto-hook active video elements
  setInterval(function () {
    var video = getVideoElement();
    if (video) attachVideoListeners(video);
  }, 1000);
})();
