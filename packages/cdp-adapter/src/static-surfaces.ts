/** Production mode: CSS owns surfaces. Only non-CSS content is initialized locally. */
export const STATIC_SURFACE_SETUP = String.raw`
    if (theme.surfaceStrategy === "static") {
      // One compatibility pass on initial application; never called by a listener.
      markSurfaces();
      collectSurfaces=false;currentSurfaces.clear();
      style.dataset.openChatgptSkinSurfaceStrategy = "static";
      let disposed = false;
      let pending = null;
      let home = null;
      let homeCandidate = null;
      let homeResize = null;
      const scopes = new Set();
      const composerEditors = new WeakMap();
      const allWithin = (scope, selector) => [
        ...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)
      ];
      const syncComposers = (scope) => {
        for(const input of allWithin(scope,'textarea,[contenteditable=true],[role=textbox]')) {
          if(insideTerminal(input) || insideOverlay(input)) continue;
          const root=input.closest(nativeSelectors.composerRoot+',.composer-surface-chrome');
          if(!root || composerEditors.get(root)===input) continue;
          const main=root.closest('main,[role=main]');
          if(!main) continue;
          let shell=root;
          for(let node=root.parentElement;node && node!==main;node=node.parentElement) {
            if(node.querySelector(nativeSelectors.homeMarker) || node.querySelector('.thread-scroll-container,[data-thread-scroll-container]')) break;
            if(/thread-content-max-width|max-w-\(--thread-content/.test(node.className || '')) {shell=node;break;}
          }
          if(shell===root && root.parentElement!==main && root.parentElement.children.length===1) shell=root.parentElement;
          if(root.matches(nativeSelectors.composerRoot)) {
            for(const node of root.querySelectorAll('[data-open-chatgpt-skin-surface="composer"],[data-open-chatgpt-skin-surface="composer-input"],[data-open-chatgpt-skin-surface="composer-chrome"]')) node.removeAttribute('data-open-chatgpt-skin-surface');
          }
          // Native layout roots are initialized once per editor mount. No
          // geometry reads, scrolling listeners, or conversation scans.
          for(let node=root.parentElement;node && node!==main;node=node.parentElement) {
            if(node.querySelector(nativeSelectors.homeMarker) || node.querySelector('.thread-scroll-container,[data-thread-scroll-container]')) break;
            if(node.matches('.composer-surface-chrome,[data-open-chatgpt-skin-surface="composer-input"],[data-open-chatgpt-skin-surface="project-picker"]')) setSurface(node,'composer-chrome');
          }
          setSurface(shell,'composer');
          if(shell!==root) setSurface(root,'composer-input');
          composerEditors.set(root,input);
        }
      };
      const syncStructure = (scope) => {
        for (const main of allWithin(scope, 'main[class*="_MainContentSurface_"],main.main-surface')) setSurface(main, 'main');
        for (const sidebar of allWithin(scope, 'aside.app-shell-left-panel')) setSurface(sidebar, 'sidebar');
        syncComposers(scope);
      };
      const syncImagery = (scope) => {
        const sidebars = allWithin(scope, 'aside.app-shell-left-panel');
        const containingSidebar = scope.closest?.('aside.app-shell-left-panel');
        if (containingSidebar) sidebars.push(containingSidebar);
        for (const sidebar of new Set(sidebars)) {
          const {accountButton:account,avatar} = resolveAccountImage(sidebar);
          for(const old of sidebar.querySelectorAll('[data-open-chatgpt-skin-interface-host="profile-avatar"]')) {
            if(old===account) continue;
            old.removeAttribute('data-open-chatgpt-skin-interface-host');
            for(const icon of old.querySelectorAll('[data-open-chatgpt-skin-native-icon="profile-avatar"]')) icon.removeAttribute('data-open-chatgpt-skin-native-icon');
            for(const image of old.querySelectorAll('[data-open-chatgpt-skin-interface-image="profile-avatar"]')) image.remove();
          }
          if (account) placeInterfaceImage(account,'profile-avatar',theme.interfaceImagery.profileAvatar,avatar,24);
          const icons=theme.interfaceImagery.projectIcons || [];
          if (!icons.length) continue;
          const rows=Array.from(sidebar.querySelectorAll('[class*="folder-row"][role=button][aria-label]'));
          for (const [index,row] of rows.slice(0,12).entries()) {
            if (!visible(row)) continue;
            const icon=Array.from(row.querySelectorAll('svg,img')).find(visible);
            if (icon?.parentElement) placeInterfaceImage(icon.parentElement,'project-icon-'+(index+1),icons[index%icons.length],icon,16);
          }
        }
      };
      const clearHome = () => {
        if (!home) return;
        homeResize?.disconnect();
        syncWelcome(null,null,null,false);
        syncCompositionLayers(document.querySelector('main[class*="_MainContentSurface_"],main.main-surface,main'),null,null,false);
        home=null;
      };
      const initializeHome = (scope) => {
        const icon=allWithin(scope,nativeSelectors.homeMarker+',[data-open-chatgpt-skin-surface="home-heading"]')[0];
        if (!icon) return;
        homeCandidate=icon;
        let main=icon.closest('main,[role=main]');
        // Some versions put the heading and composer in sibling route wrappers.
        while(main && !main.querySelector('textarea,[contenteditable=true],[role=textbox]')) main=main.parentElement?.closest('main,[role=main]');
        if (!main || main.querySelector('.thread-scroll-container,[data-thread-scroll-container]')) return;
        if (home?.main===main && home.heading?.isConnected && home.composer?.isConnected &&
          (!home.suggestions || home.suggestions.isConnected)) {
          homeCandidate=null;
          return;
        }
        const input=Array.from(main.querySelectorAll('textarea,[contenteditable=true],[role=textbox]')).find(node => !insideTerminal(node) && !insideOverlay(node) && visible(node));
        if (!input) return;
        syncComposers(main);
        const chrome=input.closest(nativeSelectors.composerRoot+',.composer-surface-chrome') || input.parentElement;
        const composer=chrome?.closest('[data-open-chatgpt-skin-surface="composer"]') ||
          chrome?.closest('[class*="thread-content-max-width"],[class*="max-w-(--thread-content"]') ||
          chrome?.parentElement || chrome;
        if (!composer) return;
        let suggestions=main.querySelector('[data-open-chatgpt-skin-surface="suggestions"]');
        if (!suggestions) {
          const parents=new Set(Array.from(main.querySelectorAll('button,[role=button]'))
            .filter(node => !composer.contains(node) && !insideOverlay(node)).map(node=>node.parentElement));
          suggestions=Array.from(parents).find(parent => {
            const cards=Array.from(parent.children).filter(node=>node.matches('button,[role=button]'));
            return cards.length>=1 && cards.length<=8 && !parent.querySelector('h1,h2,[role=heading],'+nativeSelectors.homeMarker) && cards.every(node=>{
              const rect=node.getBoundingClientRect();return rect.width>=100 && rect.height>=50;
            });
          }) || null;
        }
        const heading=main.querySelector('[data-open-chatgpt-skin-surface="home-heading"]') || resolveHomeHeading(main,composer,suggestions,visible);
        if (!heading) return;
        let hero=heading;
        for(let node=heading.parentElement;node && node!==main;node=node.parentElement) {
          if(node.contains(composer) || (suggestions && node.contains(suggestions))) break;
          if(node.getBoundingClientRect().height<=480) hero=node;
        }
        setSurface(heading,'home-heading');setSurface(hero,'hero');
        if(suggestions) {
          setSurface(suggestions,'suggestions');
          const cards=Array.from(suggestions.children).filter(node=>node.matches('button,[role=button]'));
          for(const [index,card] of cards.slice(0,8).entries()) {
            setSurface(card,'card');
            if(index<4) placeInterfaceImage(card,'suggestion-card'+(index+1),
              theme.interfaceImagery.suggestionIcons['card'+(index+1)],
              card.querySelector('svg,img'),20);
          }
        }
        home={main,hero,heading,suggestions,composer};
        syncWelcome(main,hero,heading,true);
        syncCompositionLayers(main,hero,suggestions,true);
        homeCandidate=null;
        if(window.ResizeObserver) {
          homeResize ||= new window.ResizeObserver(resizeHome);
          homeResize.disconnect();homeResize.observe(main);homeResize.observe(hero);
        }
      };
      const contentSelector='diffs-container,file-tree-container,'+nativeSelectors.accountMenu+','+nativeSelectors.composerRoot+','+nativeSelectors.homeMarker+',textarea,[contenteditable=true],[role=textbox],aside.app-shell-left-panel,[class*="folder-row"],main[class*="_MainContentSurface_"],main.main-surface';
      const flush = () => {
        pending=null;
        if(disposed) return;
        if(home && (!home.main.isConnected || !home.heading.isConnected || !home.composer.isConnected)) clearHome();
        const roots=Array.from(scopes);scopes.clear();
        for(const root of roots) if(root.isConnected) {syncComposers(root);syncImagery(root);initializeHome(root);}
        if(homeCandidate?.isConnected) initializeHome(homeCandidate);
        else homeCandidate=null;
        if(!home && theme.compositionLayers?.some(layer=>layer.surface==='main') &&
          roots.some(root=>root.matches?.('main') || root.querySelector('main'))) {
          syncCompositionLayers(document.querySelector('main[class*="_MainContentSurface_"],main.main-surface,main'),null,null,false);
        }
      };
      const enqueue = (scope) => {
        scopes.add(scope);
        if(pending===null && !disposed) pending=window.setTimeout(flush,0);
      };
      const observer=new window.MutationObserver(records=>{
        if(disposed) return;
        let detached=false;
        const reviewRoots=[];
        for(const record of records) {
          if(record.type!=='childList') continue;
          if(home && (!home.main.isConnected || !home.heading.isConnected)) detached=true;
          if(home?.main.isConnected && record.target.closest?.('[data-open-chatgpt-skin-surface="project-name"]')) {
            syncWelcome(home.main,home.hero,home.heading,true);
          }
          // React may preserve the heading while replacing the native cards
          // or composer. Recover their local bindings without rescanning history.
          if(home?.main.isConnected && home.heading.isConnected &&
            (!home.composer.isConnected || (home.suggestions && !home.suggestions.isConnected))) enqueue(home.main);
          for(const node of [...record.addedNodes,...record.removedNodes]) {
            if(node.nodeType!==1 || node.matches('[data-open-chatgpt-skin],[data-open-chatgpt-skin-interface-image]')) continue;
            if(record.target.closest?.('[data-open-chatgpt-skin-interface-host="profile-avatar"]')) enqueue(record.target);
            if(node.matches('diffs-container,file-tree-container') || node.querySelector('diffs-container,file-tree-container')) reviewRoots.push(node);
            if(node.matches(contentSelector) || node.querySelector(contentSelector)) enqueue(node);
            else if(homeCandidate?.isConnected && homeCandidate.closest('main,[role=main]')?.contains(record.target)) enqueue(homeCandidate);
          }
        }
        // Mutation microtasks run before paint: attach only the new shadow sheets
        // here, without waiting for the optional content initialization timer.
        if(reviewRoots.length) syncReviewShadowThemes(reviewRoots);
        if(detached) enqueue(document.createDocumentFragment());
      });
      // Verification is explicit, not a recurring task. It only uses semantic
      // roots and known custom elements; it never calls markSurfaces().
      window[markerKey]=()=>{
        syncStructure(document);
        syncReviewShadowThemes();
        if(home && !home.main.isConnected) clearHome();
        initializeHome(document);
        if(home) resizeHome();
      };
      const resizeHome=()=>{
        if(!home?.main.isConnected) return;
        syncWelcome(home.main,home.hero,home.heading,true);
        syncCompositionLayers(home.main,home.hero,home.suggestions,true);
      };
      resizeHome.cancel=()=>{
        disposed=true;
        homeResize?.disconnect();homeCandidate=null;
        if(pending!==null) window.clearTimeout(pending);
        pending=null;scopes.clear();
      };
      const scrollHome=(event)=>{
        if(!home?.main.isConnected) return;
        const target=event.target;
        if(target!==document && (!home.main.contains(target) || target.closest?.('textarea,[contenteditable],'+nativeSelectors.sidebar))) return;
        resizeHome();
      };
      const cancelHome=resizeHome.cancel;
      resizeHome.cancel=()=>{cancelHome();window.removeEventListener('scroll',scrollHome,true);};
      window.addEventListener('scroll',scrollHome,true);
      window[refreshListenerKey]=resizeHome;
      window.addEventListener('resize',resizeHome);
      window[observerKey]=observer;
      syncComposers(document);
      initializeHome(document);
      observer.observe(document.body,{childList:true,subtree:true});
      return true;
    }
`;
