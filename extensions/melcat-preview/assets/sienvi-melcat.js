/**
 * MelCat / Big Mel — Storefront Companion
 * File: sienvi-melcat.js
 * States: idle | watching | snark | clicked | celebrate | thinking | prowling | sleeping | minimized | eating | playing | angry | purring
 * Exposed: window.__melcat
 */
(function () {
  'use strict';

  /* ── Session Keys ──────────────────────────────────────── */
  var SK_MIN    = 'melcat_minimized_session';
  var SK_WALK   = 'melcat_walkin_seen';
  var SK_BUBBLES = 'melcat_bubble_count';
  var SK_CHAT_COUNT = 'sienvi_melcat_chat_count';
  var SK_CHAT_ENTITLED = 'sienvi_melcat_chat_entitled';
  var FREE_CHAT_LIMIT = 3;

  /* ── Local Storage Keys (Tamagotchi) ───────────────────── */
  var LK_HUNGER  = 'melcat_stat_hunger';
  var LK_BOREDOM = 'melcat_stat_boredom';
  var LK_LAST_T  = 'melcat_stat_last_time';
  var LK_REWARD  = 'melcat_reward_claimed';

  /* ── Config ────────────────────────────────────────────── */
  var CFG = {
    introDelay:      3000,
    bubbleHide:      6000,
    clickCooldown:   3000,
    autoCooldown:    15000,
    maxAutoBubbles:  6,
    inactivityMs:    30000,
    prowlMinMs:      12000,
    prowlMaxMs:      18000,
    prowlReturnMs:   7000,
    cartCooldownMs:  1500,
    // Tamagotchi Config — slow decay so he's OK most of the time
    decayIntervalMs: 180000,  // decay tick every 3 minutes
    decayRate:       2,        // only +2 per tick → ~2hrs from happy to critical
    rewardThreshold: 5,
    // Auto-care: randomly reduce stats so he doesn't just climb forever
    autoCareMinMs:   300000,  // earliest auto-care: 5 minutes
    autoCareMaxMs:   600000,  // latest auto-care: 10 minutes
    autoCareAmount:  20,      // how much stats drop on auto-care
    // Thresholds
    thresholdWarning: 60,     // watching/hungry state
    thresholdCritical: 80,    // angry/needs state
    thresholdHappy:   25,     // happy (both stats below this)
  };

  /* ── State ─────────────────────────────────────────────── */
  var S = {
    current:        'idle',
    position:       'corner',
    stateTimer:     null,
    bubbleTimer:    null,
    inactivityTimer:null,
    prowlTimer:     null,
    prowlDone:      false,
    lastAuto:       0,
    lastClick:      0,
    lastCart:       0,
    scrollShown:    false,
    introShown:     false,
    bubbleHovered:  false,
    bubbleRemaining:0,
    bubblePausedAt: 0,
    hunger:         10,
    boredom:        10,
    niceActions:    0,
    careLoopTimer:  null,
    chatOpen:       false,
    chatLoading:    false,
    chatCount:      0,
    chatSessionId:  '',
    chatUpgradeUrl: '/collections/all',
  };

  /* ── DOM refs ──────────────────────────────────────────── */
  var el = {};
  var ASSETS = {};
  var CHAT = {
    shopDomain: '',
    endpoint: '/apps/snarky/melcat/chat',
    apiEndpoint: '/api/melcat/chat',
    customerId: '',
    upgradeUrl: '/collections/all'
  };

  /* ── Message Pools ─────────────────────────────────────── */
  var MSGS = {
    home: [
      "Welcome. Regular gifts are hiding in shame.",
      "Start somewhere weird. That's where the good stuff lives.",
      "You made it. Try not to act normal.",
      "Big Mel is watching. Shop accordingly."
    ],
    collection: [
      "This collection has range. Unlike most people.",
      "Scroll slower. Some of these deserve proper judgment.",
      "Gift shopping? Pretend this was planned.",
      "There's something unhinged in here with your name on it."
    ],
    product: [
      "This one has dangerous gift potential.",
      "Add it to cart. Worst case, you become interesting.",
      "This feels personal. Probably because it is.",
      "Imagine their face when they open this. Exactly."
    ],
    cart: [
      "Look at you, making decisions.",
      "Cart looking suspiciously responsible.",
      "Proceed. The chaos is already chosen.",
      "This is the part where courage becomes checkout."
    ],
    checkout: [
      "Almost there. Don't get emotionally mature now.",
      "Finish strong. Big Mel believes in your impulse control problem.",
      "You came this far. Don't abandon the bit now."
    ],
    search: [
      "Searching? Bold. Specific chaos is my favorite.",
      "Type what your heart refuses to say out loud.",
      "Let's find the thing you'll pretend was a responsible purchase."
    ],
    default: [
      "I'm judging this page professionally.",
      "Proceed. I need to see where this goes.",
      "Something weird is probably nearby."
    ]
  };

  var CLICK_MSGS = [
    "Yes, I'm judging your cart.",
    "You rang? Make it weird.",
    "I was literally standing here being iconic.",
    "Need gift advice or emotional support? I offer one of those.",
    "Clicking the cat is a choice. I respect it.",
    "Finally, someone appreciates management.",
    "Proceed. I want to see where this goes.",
    "That product won't add itself to cart."
  ];

  var CART_MSGS = [
    "Finally. A financially responsible bad decision.",
    "Cart upgraded. Personality detected.",
    "Excellent. Chaos added.",
    "That belongs in the cart. Obviously.",
    "Big Mel approves this questionable choice."
  ];

  /* Welcome messages — fire once on page load */
  var WELCOME_MSGS = [
    "Hey. Welcome to Snarky Pets. Try not to be boring.",
    "Oh good, you're here. Big Mel has opinions about everything.",
    "Welcome. The chaos is curated. The judgment is free.",
    "You found us. That's already the best decision today."
  ];

  /* One-time tap hint messages — fires if user doesn't tap within ~10s */
  var HINT_MSGS = [
    "Psst. You can tap me.",
    "Go on. Tap me. I'll wait.",
    "*taps self for demonstration purposes*",
    "I'm interactive. Just saying."
  ];

  /* Unprompted random snark — fires during idle periods */
  var RANDOM_SNARK = [
    "Still here. Still judging.",
    "You've been on this page a while. Commitment or confusion?",
    "No pressure. Take your time. I have opinions either way.",
    "The products aren't going to add themselves.",
    "I notice things. It's a gift.",
    "You seem like someone with very specific taste. I respect it.",
    "This silence is comfortable. For me. Less so for your cart."
  ];

  /* ── State Emotion Messages ─────────────────────────────── */
  /* Short texts that communicate Big Mel's feeling per state   */
  var STATE_EMOTIONS = {
    watching: [
      "*narrows eyes suspiciously*",
      "I see you scrolling.",
      "Watching. Judging. Both.",
      "This is the look I give indecision."
    ],
    sleeping: [
      "zzz... *judging you in dreams*",
      "I'm resting. I earned it.",
      "Wake me when you add something to cart.",
      "zzz... *purring disapproval*"
    ],
    prowling: [
      "Just stretching. Don't make it weird.",
      "I go where the chaos is.",
      "Repositioning with purpose.",
      "New angle. Same judgment."
    ],
    thinking: [
      "Processing your choices...",
      "Give me a moment. This is a lot.",
      "...",
      "Calculating maximum snark..."
    ]
  };

  /* ── Helpers ───────────────────────────────────────────── */
  function pick(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function respectsReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function getBubbleCount() {
    return Number(sessionStorage.getItem(SK_BUBBLES) || '0');
  }
  function incBubbleCount() {
    sessionStorage.setItem(SK_BUBBLES, String(getBubbleCount() + 1));
  }
  function getChatCount() {
    return Number(sessionStorage.getItem(SK_CHAT_COUNT) || '0');
  }
  function setChatCount(count) {
    S.chatCount = Math.max(0, count || 0);
    sessionStorage.setItem(SK_CHAT_COUNT, String(S.chatCount));
  }
  function getRemainingFreeChats() {
    return Math.max(0, FREE_CHAT_LIMIT - getChatCount());
  }
  function isEntitledSession() {
    return sessionStorage.getItem(SK_CHAT_ENTITLED) === 'true';
  }
  function setEntitledSession(isEntitled) {
    sessionStorage.setItem(SK_CHAT_ENTITLED, isEntitled ? 'true' : 'false');
  }
  function ensureChatSessionId() {
    if (S.chatSessionId) return S.chatSessionId;
    var existing = sessionStorage.getItem('sienvi_melcat_session_id');
    if (existing) {
      S.chatSessionId = existing;
      return existing;
    }
    var next = 'melcat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('sienvi_melcat_session_id', next);
    S.chatSessionId = next;
    return next;
  }

  /* ── Init ──────────────────────────────────────────────── */
  function initMelCat() {
    el.root        = document.querySelector('.melcat-companion');
    el.character   = document.querySelector('.melcat-character');
    el.mascot      = document.querySelector('.melcat-mascot');
    el.bubble      = document.querySelector('.melcat-bubble');
    el.message     = document.querySelector('.melcat-message');
    el.actions     = document.querySelector('.melcat-actions');
    el.cta         = document.querySelector('.melcat-cta');
    el.careMenu    = document.querySelector('.melcat-care-menu');
    el.careBtns    = document.querySelectorAll('.melcat-care-btn');
    el.statusText  = document.getElementById('melcat-status-text');
    el.dismiss     = document.querySelector('.melcat-dismiss');
    el.thinking    = document.querySelector('.melcat-thinking');
    el.tapLabel    = document.querySelector('.melcat-tap-label');
    el.chatToggle  = document.getElementById('sienvi-melcat-chat');
    el.chatPanel   = document.getElementById('sienvi-melcat-chat-panel');
    el.chatForm    = document.getElementById('sienvi-melcat-chat-form');
    el.chatInput   = document.getElementById('sienvi-melcat-chat-input');
    el.chatMessages = document.getElementById('sienvi-melcat-chat-messages');
    el.chatUpgrade = document.getElementById('sienvi-melcat-chat-upgrade');
    el.chatClose   = document.getElementById('sienvi-melcat-chat-close');

    if (!el.root) return;

    var assetScript = document.getElementById('melcat-asset-urls');
    if (assetScript) {
      try { ASSETS = JSON.parse(assetScript.textContent); } catch(e) {}
    }
    var chatConfig = document.getElementById('melcat-chat-config');
    if (chatConfig) {
      try {
        var parsed = JSON.parse(chatConfig.textContent || '{}');
        CHAT.shopDomain = parsed.shopDomain || '';
        CHAT.endpoint = parsed.chatEndpoint || CHAT.endpoint;
        CHAT.apiEndpoint = parsed.apiEndpoint || CHAT.apiEndpoint;
        CHAT.customerId = parsed.customerId || '';
        CHAT.upgradeUrl = parsed.upgradeUrl || CHAT.upgradeUrl;
        S.chatUpgradeUrl = CHAT.upgradeUrl;
      } catch (e) {}
    }
    setChatCount(getChatCount());
    ensureChatSessionId();

    if (restoreFromSession()) return;

    triggerWalkIn();

    if (el.dismiss)   el.dismiss.addEventListener('click', minimizeForSession);
    if (el.character)  el.character.addEventListener('click', handleMascotClick);
    if (el.careBtns) {
      el.careBtns.forEach(function(btn) {
        btn.addEventListener('click', handleCareAction);
      });
    }
    if (el.chatToggle) el.chatToggle.addEventListener('click', toggleChatPanel);
    if (el.chatClose) el.chatClose.addEventListener('click', closeChatPanel);
    if (el.character) el.character.addEventListener('keydown', handleCharacterKeydown);
    if (el.chatForm) el.chatForm.addEventListener('submit', handleChatSubmit);
    if (el.chatPanel) {
      el.chatPanel.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && S.chatOpen) {
          event.preventDefault();
          closeChatPanel();
        }
      });
    }

    if (el.bubble) {
      el.bubble.addEventListener('mouseenter', pauseBubbleTimer);
      el.bubble.addEventListener('mouseleave', resumeBubbleTimer);
      el.bubble.addEventListener('focusin',    pauseBubbleTimer);
      el.bubble.addEventListener('focusout',   resumeBubbleTimer);
    }

    ['mousemove','scroll','keydown','click','touchstart'].forEach(function(ev) {
      document.addEventListener(ev, wakeFromSleep, { passive: true });
    });

    scheduleIntro();
    handleScrollDepth();
    scheduleProwl();
    startInactivityTimer();
    initCartDetection();
    scheduleRandomSnark();
    startGameLoop();
  }

  /* ── State Machine ─────────────────────────────────────── */
  function showStateEmotion(stateName) {
    var pool = STATE_EMOTIONS[stateName];
    if (!pool) return;
    // Don't show if bubble is already showing a longer message
    if (el.bubble && el.bubble.classList.contains('is-visible')) return;
    say(pick(pool), { duration: 4000, isStateEmotion: true });
  }

  /* ── Passive states that need-sync is allowed to override ── */
  /* NOTE: 'snark' is intentionally excluded — snarky messages must not be 
     interrupted by the sync loop or they'll never fire visibly            */
  var PASSIVE_STATES = { idle: 1, watching: 1, clicked: 1, angry: 1 };

  /**
   * After stats change, realign the visual state to what Big Mel
   * actually feels — but only if he isn't mid-interaction.
   */
  function syncStateToNeeds() {
    if (!PASSIVE_STATES[S.current]) return; // don't interrupt eating, sleeping, snark, etc.
    if (S.current === 'minimized') return;

    if (S.hunger >= CFG.thresholdCritical || S.boredom >= CFG.thresholdCritical) {
      if (S.current !== 'angry') setState('angry');
    } else if (S.hunger >= CFG.thresholdWarning || S.boredom >= CFG.thresholdWarning) {
      if (S.current !== 'watching') setState('watching');
    } else if (S.hunger <= CFG.thresholdHappy && S.boredom <= CFG.thresholdHappy) {
      if (S.current !== 'idle') setState('idle');
    }
    // In the middle range (25-59): leave whatever passive state he settled in
  }

  function setState(nextState, duration) {
    clearTimeout(S.stateTimer);
    var prev = S.current;

    // When falling back to idle, keep him angry/watching if needs demand it
    if (nextState === 'idle') {
      if (S.hunger >= CFG.thresholdCritical || S.boredom >= CFG.thresholdCritical) {
        nextState = 'angry';
      } else if (S.hunger >= CFG.thresholdWarning || S.boredom >= CFG.thresholdWarning) {
        nextState = 'watching';
      }
    }

    S.current = nextState;
    if (el.root) el.root.dataset.melcatState = nextState;
    
    if (ASSETS[nextState] && el.mascot) {
      el.mascot.src = ASSETS[nextState];
    } else if (ASSETS['idle'] && el.mascot && nextState === 'idle') {
      el.mascot.src = ASSETS['idle'];
    }

    // Show a short emotion text when entering expressive states
    // Only if not already mid-message and not transitioning from same state
    if (nextState !== prev && nextState !== 'minimized' && nextState !== 'idle') {
      setTimeout(function() {
        if (S.current === nextState) showStateEmotion(nextState);
      }, 300); // slight delay so animation starts first
    }

    if (duration) {
      S.stateTimer = setTimeout(function() { setState('idle'); }, duration);
    }

    updateStatsUI();
  }

  function setPosition(pos) {
    S.position = pos;
    if (el.root) el.root.dataset.melcatPosition = pos;
  }

  /* ── Page Type ─────────────────────────────────────────── */
  function detectPageType() {
    var p = window.location.pathname;
    if (p === '/')                        return 'home';
    if (p.indexOf('/products/') !== -1)   return 'product';
    if (p.indexOf('/collections/') !== -1)return 'collection';
    if (p.indexOf('/cart') !== -1)        return 'cart';
    if (p.indexOf('/checkout') !== -1)    return 'checkout';
    if (p.indexOf('/search') !== -1)      return 'search';
    return 'default';
  }

  var pageType = detectPageType();

  function getRandomMessage(type) {
    return pick(MSGS[type] || MSGS.default);
  }

  /* ── Bubble ────────────────────────────────────────────── */
  function say(message, options) {
    options = options || {};
    if (!el.bubble || !el.message) return;
    if (S.current === 'minimized') return;
    // Do not override a longer substantive message with a state emotion
    if (!options.isStateEmotion && el.bubble.classList.contains('is-visible')) {
      // Still replace — substantive messages win over state emotions
    }

    clearTimeout(S.bubbleTimer);

    el.message.textContent = message;
    el.bubble.removeAttribute('hidden');
    el.bubble.classList.add('is-visible');

    if (options.cta && el.cta && el.actions) {
      el.cta.textContent = options.cta.label;
      el.cta.href        = options.cta.href || '#';
      if (options.cta.action) {
        el.cta.onclick = function(e) { e.preventDefault(); options.cta.action(); };
      } else {
        el.cta.onclick = null;
      }
      el.actions.removeAttribute('hidden');
    } else if (el.actions) {
      el.actions.setAttribute('hidden', '');
    }

    if (options.showCareMenu && el.careMenu) {
      el.careMenu.removeAttribute('hidden');
    } else if (el.careMenu) {
      el.careMenu.setAttribute('hidden', '');
    }

    var duration = options.duration || CFG.bubbleHide;
    S.bubbleRemaining = duration;
    S.bubblePausedAt  = 0;
    S.bubbleTimer = setTimeout(function() {
      if (!S.bubbleHovered) hideBubble();
    }, duration);
  }

  function hideBubble() {
    clearTimeout(S.bubbleTimer);
    if (!el.bubble) return;
    el.bubble.classList.remove('is-visible');
    var b = el.bubble;
    var onEnd = function() {
      b.setAttribute('hidden', '');
      b.removeEventListener('transitionend', onEnd);
    };
    b.addEventListener('transitionend', onEnd);
  }

  function pauseBubbleTimer() {
    S.bubbleHovered  = true;
    S.bubblePausedAt = Date.now();
    clearTimeout(S.bubbleTimer);
  }

  function resumeBubbleTimer() {
    S.bubbleHovered = false;
    if (!el.bubble || el.bubble.hasAttribute('hidden')) return;
    var elapsed   = Date.now() - S.bubblePausedAt;
    var remaining = Math.max(1000, S.bubbleRemaining - elapsed);
    S.bubbleTimer = setTimeout(hideBubble, remaining);
  }

  /* ── Click Handler ───────────────────────────────────────── */
  function clearTapHint() {
    if (el.character) el.character.classList.remove('melcat-hint-pulse');
    if (el.tapLabel)  el.tapLabel.classList.remove('is-visible');
  }
  function handleMascotClick() {
    clearTapHint();
    var now = Date.now();
    if (now - S.lastClick < CFG.clickCooldown) return;
    S.lastClick = now;

    setState('clicked');
    setTimeout(function() { if (S.current === 'clicked') setState('idle'); }, 650);

    // If hungry or bored, complain instead of normal click msg
    if (S.hunger >= 80 || S.boredom >= 80) {
      setState('angry', 6000);
      var complaint = S.hunger >= 80 
        ? "I am literally starving while you look at things."
        : "I am dying of boredom down here.";
      say(complaint, { duration: 6000, showCareMenu: true });
      return;
    }

    var msg = pick(CLICK_MSGS);

    // CTA only when the message is specifically actionable — not on every tap
    var cta = null;
    if (pageType === 'product' && msg === "That product won't add itself to cart.") {
      var atc = document.querySelector('[name="add"]') ||
                document.querySelector('button[data-add-to-cart]') ||
                document.querySelector('.product-form__submit');
      if (atc) {
        cta = { label: 'Add it already \u2192', href: '#', action: function() {
          atc.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }};
      }
    }

    var needsCare = S.hunger >= CFG.thresholdWarning || S.boredom >= CFG.thresholdWarning;
    say(msg, { duration: 8000, cta: cta, showCareMenu: needsCare });
    openChatPanel();
  }
  function handleCharacterKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      return;
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !S.chatOpen) {
      event.preventDefault();
      openChatPanel();
    }
  }

  function pageTitle() {
    var titleEl = document.querySelector('h1');
    return titleEl ? titleEl.textContent.trim() : undefined;
  }

  function detectChatEndpoint() {
    return CHAT.endpoint || CHAT.apiEndpoint;
  }

  function resolveShopDomain() {
    if (CHAT.shopDomain) return CHAT.shopDomain;
    // Fallback: Shopify injects window.Shopify.shop on every storefront page
    if (window.Shopify && window.Shopify.shop) return window.Shopify.shop;
    // Last resort: derive from hostname (works for *.myshopify.com)
    var host = window.location.hostname;
    if (host.indexOf('.myshopify.com') !== -1) return host;
    return '';
  }

  function appendChatMessage(kind, text) {
    if (!el.chatMessages) return;
    var item = document.createElement('div');
    item.className = 'sienvi-melcat-chat-message is-' + kind;
    item.textContent = text;
    el.chatMessages.appendChild(item);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function setChatLoading(isLoading) {
    S.chatLoading = isLoading;
    if (el.chatForm) el.chatForm.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (el.chatInput) el.chatInput.disabled = isLoading;
    if (el.chatForm) {
      var submit = el.chatForm.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = isLoading;
        submit.textContent = isLoading ? 'Thinking...' : 'Send';
      }
    }
    if (isLoading) setState('thinking');
    else if (S.current === 'thinking') setState('idle');
  }

  function syncUpgradeState(forceShow) {
    if (!el.chatUpgrade) return;
    var shouldShow = !!forceShow || getRemainingFreeChats() === 0;
    if (shouldShow) {
      el.chatUpgrade.removeAttribute('hidden');
      var link = el.chatUpgrade.querySelector('a');
      if (link) link.href = S.chatUpgradeUrl || CHAT.upgradeUrl;
    } else {
      el.chatUpgrade.setAttribute('hidden', '');
    }
  }

  function openChatPanel() {
    if (!el.chatPanel) return;
    S.chatOpen = true;
    if (el.root) el.root.dataset.melcatChatOpen = 'true';
    el.chatPanel.removeAttribute('hidden');
    el.chatPanel.setAttribute('aria-hidden', 'false');
    if (el.chatToggle) el.chatToggle.setAttribute('aria-expanded', 'true');
    syncUpgradeState(false);
    setTimeout(function() {
      if (el.chatInput) el.chatInput.focus();
    }, 20);
  }

  function closeChatPanel() {
    if (!el.chatPanel) return;
    S.chatOpen = false;
    if (el.root) el.root.dataset.melcatChatOpen = 'false';
    el.chatPanel.setAttribute('hidden', '');
    el.chatPanel.setAttribute('aria-hidden', 'true');
    if (el.chatToggle) el.chatToggle.setAttribute('aria-expanded', 'false');
    if (el.chatToggle) el.chatToggle.focus();
  }

  function toggleChatPanel() {
    if (S.chatOpen) closeChatPanel();
    else openChatPanel();
  }

  async function handleChatSubmit(event) {
    event.preventDefault();
    if (!el.chatInput) return;

    var message = el.chatInput.value.trim();
    if (!message || S.chatLoading) return;

    if (!isEntitledSession() && getChatCount() >= FREE_CHAT_LIMIT) {
      openChatPanel();
      syncUpgradeState(true);
      appendChatMessage('system', "That's all the free judgment you get. Unlock full Big Mel to keep chatting.");
      return;
    }

    openChatPanel();
    appendChatMessage('user', message);
    el.chatInput.value = '';
    setChatLoading(true);

    try {
      var body = new URLSearchParams();
      body.set('shopDomain', resolveShopDomain());
      body.set('sessionId', ensureChatSessionId());
      if (CHAT.customerId) body.set('customerId', CHAT.customerId);
      body.set('message', message);
      body.set('clientChatCount', String(getChatCount()));
      body.set('upgradeUrl', S.chatUpgradeUrl);
      body.set('pageContext', JSON.stringify({
        path: window.location.pathname,
        pageType: pageType,
        productTitle: pageTitle()
      }));
      body.set('cartContext', JSON.stringify({
        itemCount: readCartCount()
      }));

      var response = await fetch(detectChatEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString()
      });

      var data = await response.json().catch(function() { return null; });
      if (!response.ok || !data || !data.reply) {
        if (response.status === 403 && data && data.upgradeRequired) {
          syncUpgradeState(true);
          appendChatMessage('system', "That's all the free judgment you get. Unlock full Big Mel to keep chatting.");
          return;
        }
        throw new Error((data && data.error) || 'Big Mel is unavailable right now.');
      }

      appendChatMessage('assistant', data.reply);
      if (data.upgradeUrl) S.chatUpgradeUrl = data.upgradeUrl;
      setEntitledSession(!!data.isEntitled);
      // Only count against the free limit when the server confirms AI responded.
      // Fallback replies (aiSucceeded: false) don't consume a free chat.
      if (!data.isEntitled && data.aiSucceeded !== false) {
        setChatCount(FREE_CHAT_LIMIT - Math.max(0, data.remainingChats || 0));
      }
      syncUpgradeState(!!data.upgradeRequired);
      setState('snark', 5000);
      say(data.reply, { duration: 7000 });
    } catch (error) {
      appendChatMessage('error', error && error.message ? error.message : 'Big Mel is unavailable right now.');
      syncUpgradeState(false);
    } finally {
      setChatLoading(false);
    }
  }

  function readCartCount() {
    var countEl = document.querySelector('[data-cart-item-count]');
    if (countEl) {
      var count = parseInt(countEl.textContent, 10);
      if (!isNaN(count)) return count;
    }
    var qtyInputs = document.querySelectorAll('input[name="updates[]"], input.quantity__input');
    if (qtyInputs && qtyInputs.length) {
      var total = 0;
      qtyInputs.forEach(function(input) {
        var value = parseInt(input.value, 10);
        if (!isNaN(value)) total += value;
      });
      return total;
    }
    return undefined;
  }

  /* ── Tamagotchi Logic ──────────────────────────────────── */
  function loadStats() {
    S.hunger  = parseInt(localStorage.getItem(LK_HUNGER)  || '10', 10);
    S.boredom = parseInt(localStorage.getItem(LK_BOREDOM) || '10', 10);
    
    var lastTimeStr = localStorage.getItem(LK_LAST_T);
    var lastTime = lastTimeStr ? parseInt(lastTimeStr, 10) : Date.now();
    var now = Date.now();
    var elapsedMins = Math.floor((now - lastTime) / 60000);
    
    if (elapsedMins > 0) {
      S.hunger  = Math.min(100, S.hunger + (elapsedMins * CFG.decayRate));
      S.boredom = Math.min(100, S.boredom + (elapsedMins * CFG.decayRate));
      localStorage.setItem(LK_LAST_T, now.toString());
      saveStats();
    } else {
      updateStatsUI();
    }
  }

  function updateStatsUI() {
    if (!el.statusText) return;
    var status = "STATUS: OK";
    
    if (S.current === 'eating')         status = "STATUS: EATING";
    else if (S.current === 'playing')   status = "STATUS: PLAYING";
    else if (S.current === 'purring')   status = "STATUS: PURRING";
    else if (S.current === 'angry')     status = "STATUS: ANGRY!";
    else if (S.current === 'sleeping')  status = "STATUS: SLEEPING";
    else if (S.current === 'prowling')  status = "STATUS: PROWLING";
    else if (S.current === 'thinking')  status = "STATUS: THINKING";
    else if (S.current === 'celebrate') status = "STATUS: HAPPY!";
    else if (S.hunger >= CFG.thresholdCritical) status = "NEEDS: FOOD!";
    else if (S.boredom >= CFG.thresholdCritical) status = "NEEDS: PLAY!";
    else if (S.hunger >= CFG.thresholdWarning)   status = "STATUS: HUNGRY";
    else if (S.boredom >= CFG.thresholdWarning)  status = "STATUS: BORED";
    else if (S.hunger <= CFG.thresholdHappy && S.boredom <= CFG.thresholdHappy) status = "STATUS: HAPPY";
    else                                         status = "STATUS: OK";

    el.statusText.textContent = status;
  }

  function saveStats() {
    localStorage.setItem(LK_HUNGER, S.hunger.toString());
    localStorage.setItem(LK_BOREDOM, S.boredom.toString());
    updateStatsUI();
    syncStateToNeeds(); // keep visual state in sync with needs after every save
  }

  function startGameLoop() {
    loadStats();
    S.careLoopTimer = setInterval(function() {
      S.hunger  = Math.min(100, S.hunger + CFG.decayRate);
      S.boredom = Math.min(100, S.boredom + CFG.decayRate);
      localStorage.setItem(LK_LAST_T, Date.now().toString());
      saveStats();
    }, CFG.decayIntervalMs);
    scheduleAutoCare();
  }

  /* ── Auto-care: Big Mel randomly feeds/entertains himself ── */
  /* Keeps stats from monotonically climbing so STATUS: OK is the norm */
  var AUTO_CARE_MSGS = [
    "Found a snack. Don't worry about it.",
    "I entertained myself. Briefly.",
    "Handled it. You're welcome.",
    "Self-sufficient. As always.",
    "Took care of that. No thanks needed."
  ];

  function scheduleAutoCare() {
    var delay = CFG.autoCareMinMs + Math.random() * (CFG.autoCareMaxMs - CFG.autoCareMinMs);
    setTimeout(function fireAutoCare() {
      if (S.current !== 'minimized') {
        // Randomly care for whichever stat is higher, or pick randomly
        var reduceHunger = S.hunger >= S.boredom ? true : Math.random() < 0.5;
        if (reduceHunger) {
          S.hunger = Math.max(0, S.hunger - CFG.autoCareAmount);
        } else {
          S.boredom = Math.max(0, S.boredom - CFG.autoCareAmount);
        }
        saveStats();
        // Occasionally surface a message so the user sees something happened
        if (Math.random() < 0.4) {
          say(pick(AUTO_CARE_MSGS), { duration: 4000 });
        }
      }
      // Schedule the next auto-care
      var nextDelay = CFG.autoCareMinMs + Math.random() * (CFG.autoCareMaxMs - CFG.autoCareMinMs);
      setTimeout(fireAutoCare, nextDelay);
    }, delay);
  }

  function checkReward() {
    if (localStorage.getItem(LK_REWARD) === 'true') return false;
    S.niceActions++;
    if (S.niceActions >= CFG.rewardThreshold) {
      localStorage.setItem(LK_REWARD, 'true');
      return true;
    }
    return false;
  }

  function handleCareAction(e) {
    e.preventDefault();
    e.stopPropagation();
    
    var action = e.currentTarget.getAttribute('data-action');
    var msg = "";
    var isReward = false;
    
    // Hide the care menu after clicking
    if (el.careMenu) el.careMenu.setAttribute('hidden', '');
    
    // Interaction cooldown to prevent spamming
    var now = Date.now();
    if (now - (S.lastCare || 0) < 1000) return;
    S.lastCare = now;

    if (action === 'feed') {
      if (S.hunger === 0) {
        msg = "I am literally full. Do I look like a garbage disposal?";
        setState('snark', 4000);
      } else {
        S.hunger = Math.max(0, S.hunger - 30);
        setState('eating', 4000);
        msg = "Acceptable offering. The void is slightly less hungry.";
        isReward = checkReward();
      }
    } else if (action === 'play') {
      if (S.boredom === 0) {
        msg = "I am currently too stimulated for this nonsense.";
        setState('watching', 4000);
      } else {
        S.boredom = Math.max(0, S.boredom - 30);
        setState('playing', 4000);
        msg = "I will destroy this string. Thank you.";
        isReward = checkReward();
      }
    } else if (action === 'pet') {
      S.hunger = Math.max(0, S.hunger - 5);
      S.boredom = Math.max(0, S.boredom - 5);
      setState('purring', 3000);
      msg = "*purrs aggressively* Don't tell anyone you saw this.";
      isReward = checkReward();
    }
    saveStats();
    
    if (isReward) {
      say("Fine. You aren't terrible. You kept me fed. Use code MELCARES for 10% off.", { duration: 12000 });
    } else {
      say(msg, { duration: 8000 });
    }
  }

  /* ── Auto Message Guard ────────────────────────────────── */
  function canShowAuto() {
    if (S.current === 'minimized')  return false;
    if (S.current === 'celebrate')  return false;
    if (getBubbleCount() >= CFG.maxAutoBubbles) return false;
    if (Date.now() - S.lastAuto < CFG.autoCooldown) return false;
    return true;
  }

  function showAuto(msg, stateName, duration) {
    if (!canShowAuto()) return false;
    S.lastAuto = Date.now();
    incBubbleCount();
    setState(stateName || 'snark', duration || 7000);
    say(msg, { duration: duration || 6000 });
    return true;
  }

  /* ── Welcome (fires once on page load) ─────────────────── */
  function showWelcome() {
    if (S.current === 'minimized') return;
    var shopCta = { label: 'Shop now →', href: '/collections/all' };
    // On product page, CTA scrolls to add-to-cart
    if (pageType === 'product') {
      var atc = document.querySelector('[name="add"]') ||
                document.querySelector('button[data-add-to-cart]') ||
                document.querySelector('.product-form__submit');
      if (atc) {
        shopCta = { label: 'Add it to cart →', href: '#', action: function() {
          atc.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }};
      }
    } else if (pageType === 'cart') {
      shopCta = { label: 'Checkout →', href: '/checkout' };
    } else if (pageType === 'collection') {
      shopCta = { label: 'Keep browsing →', href: window.location.pathname };
    }
    say(pick(WELCOME_MSGS), { duration: 8000, cta: shopCta });
    S.introShown = true; // welcome counts as intro — don't double-fire
    setTimeout(showTapHint, 9000); // 9 seconds after welcome
  }

  /* ── Tap Hint (one-time, fires if no click within ~9s of welcome) ── */
  function showTapHint() {
    if (S.lastClick > 0) return;          // already clicked, skip
    if (S.current === 'minimized') return;
    if (respectsReducedMotion()) return;

    // Pulse ring — runs 5 times (~7s) then done
    if (el.character) el.character.classList.add('melcat-hint-pulse');

    // Floating "tap me" label — shows briefly then fades
    if (el.tapLabel) {
      el.tapLabel.classList.add('is-visible');
      setTimeout(function() {
        if (el.tapLabel) el.tapLabel.classList.remove('is-visible');
      }, 3000);
    }

    // Remove the ring class after animation completes (5 × 1.4s = 7s)
    setTimeout(function() {
      if (el.character) el.character.classList.remove('melcat-hint-pulse');
    }, 7500);

    // If still no click after hint, show a one-liner
    setTimeout(function() {
      if (S.lastClick > 0) return;
      if (S.current === 'minimized') return;
      say(pick(HINT_MSGS), { duration: 4000 });
    }, 4000);
  }

  /* ── Random Unprompted Snark ────────────────────────────────── */
  var randomSnarkCount = 0;
  var MAX_RANDOM_SNARK = 3;

  function scheduleRandomSnark() {
    if (pageType === 'checkout') return; // never on checkout
    // Fire between 45-90s after page load, then repeat
    var delay = 45000 + Math.random() * 45000;
    setTimeout(function fireSnark() {
      if (randomSnarkCount >= MAX_RANDOM_SNARK) return;
      if (S.current === 'minimized') return;
      if (S.current === 'celebrate') return;
      // Only fire if user hasn't interacted recently (inactivity > 20s)
      var quietFor = Date.now() - Math.max(S.lastClick, S.lastCart, S.lastAuto);
      if (quietFor < 20000) {
        // Try again later
        setTimeout(fireSnark, 30000);
        return;
      }
      // Pick from random snark OR page-aware pool (50/50)
      var msg = Math.random() < 0.5
        ? pick(RANDOM_SNARK)
        : getRandomMessage(pageType);
      var showed = showAuto(msg, 'snark', 6000);
      if (showed) {
        randomSnarkCount++;
        // Schedule the next one
        var nextDelay = 60000 + Math.random() * 60000;
        setTimeout(fireSnark, nextDelay);
      }
    }, delay);
  }

  /* ── Intro ─────────────────────────────────────────────── */
  function scheduleIntro() {
    setTimeout(function() {
      if (S.introShown || S.current === 'minimized') return;
      S.introShown = true;
      // CTA only on home and cart pages for the intro — other pages are just snark
      var cta = null;
      if (pageType === 'home' || pageType === 'default') {
        cta = { label: 'Shop more chaos →', href: '/collections/all' };
      } else if (pageType === 'cart') {
        cta = { label: 'Checkout →', href: '/checkout' };
      }
      var msg = getRandomMessage(pageType);
      setState('snark', 7000);
      say(msg, { duration: 6500, cta: cta });
      S.lastAuto = Date.now();
      incBubbleCount();
    }, CFG.introDelay);
  }

  /* ── Scroll Depth ──────────────────────────────────────── */
  function handleScrollDepth() {
    var throttle = null;
    function onScroll() {
      if (S.scrollShown) { window.removeEventListener('scroll', onScroll); return; }
      if (throttle) return;
      throttle = setTimeout(function() {
        throttle = null;
        var scrolled = window.scrollY || document.documentElement.scrollTop;
        var total = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        ) - window.innerHeight;
        if (total > 0 && scrolled / total >= 0.30) {
          S.scrollShown = true;
          setState('watching');
          setTimeout(function() {
            showAuto(getRandomMessage(pageType), 'snark', 6000);
          }, 800);
        }
      }, 200);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── Prowl ─────────────────────────────────────────────── */
  function isSafeToProwl() {
    if (respectsReducedMotion()) return false;
    if (S.prowlDone)             return false;
    if (S.current === 'minimized') return false;
    if (pageType === 'checkout') return false;
    if (window.innerWidth < 500) return false;
    var modal = document.querySelector(
      '[class*="drawer"][aria-hidden="false"],[class*="modal"][aria-hidden="false"]'
    );
    if (modal) return false;
    return true;
  }

  function scheduleProwl() {
    var delay = CFG.prowlMinMs + Math.random() * (CFG.prowlMaxMs - CFG.prowlMinMs);
    S.prowlTimer = setTimeout(function() {
      if (!isSafeToProwl()) return;
      S.prowlDone = true;
      setState('prowling');
      
      // Delay position shift slightly to let the walking WebP load/start
      setTimeout(function() {
        setPosition('prowl-left');
      }, 50);

      // Stop walking once he reaches the left side (after 4 seconds)
      setTimeout(function() {
        if (S.current === 'prowling') setState('idle');
      }, 4000);

      // Return to corner after a while
      setTimeout(function() {
        setPosition('corner');
        // He slides back fast (1.1s) while idle
      }, CFG.prowlReturnMs);
    }, delay);
  }

  /* ── Inactivity / Sleep ────────────────────────────────── */
  function startInactivityTimer() {
    clearTimeout(S.inactivityTimer);
    if (S.current === 'minimized') return;
    S.inactivityTimer = setTimeout(function() {
      if (S.current === 'celebrate') return;
      hideBubble();
      setState('sleeping');
    }, CFG.inactivityMs);
  }

  function wakeFromSleep() {
    if (S.current === 'sleeping') setState('idle');
    startInactivityTimer();
  }

  /* ── Session ───────────────────────────────────────────── */
  function minimizeForSession() {
    clearTimeout(S.bubbleTimer);
    clearTimeout(S.stateTimer);
    clearTimeout(S.inactivityTimer);
    clearTimeout(S.prowlTimer);
    hideBubble();
    closeChatPanel();
    setState('minimized');
    sessionStorage.setItem(SK_MIN, 'true');
  }

  function restoreFromSession() {
    if (sessionStorage.getItem(SK_MIN) === 'true') {
      setState('minimized');
      return true;
    }
    return false;
  }

  /* ── Walk-in ────────────────────────────────────────────── */
  function triggerWalkIn() {
    if (!el.root) return;
    var isFirstVisit = sessionStorage.getItem(SK_WALK) !== 'true';
    sessionStorage.setItem(SK_WALK, 'true');

    if (isFirstVisit) {
      // First visit this session: reset stats so he greets at STATUS: OK
      S.hunger  = 10;
      S.boredom = 10;
      saveStats();

      // Walk-in animation then welcome message
      el.root.classList.add('melcat-walkin');
      setTimeout(function() {
        el.root.classList.remove('melcat-walkin');
        setState('snark');
        setTimeout(showWelcome, 200);
      }, 1000);
    }
    // Repeat visits: no walk-in, intro fires via scheduleIntro()
  }

  /* ── Add-to-Cart Detection ─────────────────────────────── */
  function celebrateAddToCart() {
    var now = Date.now();
    if (now - S.lastCart < CFG.cartCooldownMs) return;
    S.lastCart = now;
    setState('celebrate', 4500);
    say(pick(CART_MSGS), { duration: 4000 });
  }

  function initCartDetection() {
    // Layer 1: Form submit
    document.addEventListener('submit', function(e) {
      var f = e.target;
      if (!(f instanceof HTMLFormElement)) return;
      if ((f.getAttribute('action') || '').indexOf('/cart/add') !== -1) {
        celebrateAddToCart();
      }
    }, true);

    // Layer 2: Fetch wrapper (guard against double-wrap)
    if (!window.__melcatFetchWrapped) {
      window.__melcatFetchWrapped = true;
      var origFetch = window.fetch;
      window.fetch = async function() {
        var args = Array.prototype.slice.call(arguments);
        var res  = await origFetch.apply(this, args);
        try {
          var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
          if (url.indexOf('/cart/add') !== -1) celebrateAddToCart();
        } catch(_) {}
        return res;
      };
    }

    // Layer 3: Cart count DOM observer
    var countEl = document.querySelector('[data-cart-item-count]');
    if (countEl) {
      var lastCount = parseInt(countEl.textContent, 10) || 0;
      new MutationObserver(function() {
        var n = parseInt(countEl.textContent, 10) || 0;
        if (n > lastCount) celebrateAddToCart();
        lastCount = n;
      }).observe(countEl, { childList: true, subtree: true, characterData: true });
    }
  }

  /* ── Boot ──────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMelCat);
  } else {
    initMelCat();
  }

  // Dev console access
  window.__melcat = {
    setState:    setState,
    setPosition: setPosition,
    say:         say,
    hideBubble:  hideBubble,
    openChat:    openChatPanel,
    getState:    function() { return S.current; },
    getPosition: function() { return S.position; }
  };

})();
