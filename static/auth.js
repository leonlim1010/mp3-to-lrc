(function () {
    const nativeFetch = window.fetch.bind(window);
    let client = null;
    let session = null;
    let config = null;
    let initError = null;

    // Capture this before Supabase removes OAuth tokens from the URL.
    const authCallback = (() => {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        return query.has('code') || query.has('error') || query.has('error_description') ||
            hash.has('access_token') || hash.has('refresh_token') || hash.has('error') ||
            hash.has('error_description');
    })();
    const authCallbackType = (() => {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        return query.get('type') || hash.get('type') || '';
    })();

    function callbackError() {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        return query.get('error_description') || hash.get('error_description') ||
            query.get('error') || hash.get('error');
    }

    function clearAuthCallbackUrl() {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    function withTimeout(promise, milliseconds, label) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out. Please retry.`)), milliseconds);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    const ready = (async () => {
        config = await withTimeout(
            nativeFetch('/api/config', { cache: 'no-store' }).then(response => {
                if (!response.ok) throw new Error(`Configuration failed (${response.status}).`);
                return response.json();
            }), 10000, 'Configuration request'
        );
        window.appConfig = config;
        if (!config.accounts_enabled) {
            updateAccountUi(null, false);
            return;
        }
        client = window.supabase.createClient(config.supabase_url, config.supabase_key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'soniscript-auth-v2'
            }
        });

        // Supabase completes redirected OAuth asynchronously during client
        // initialization. Subscribe immediately so that event cannot be missed.
        let resolveCallbackSession;
        const callbackSession = new Promise(resolve => { resolveCallbackSession = resolve; });
        client.auth.onAuthStateChange((_event, nextSession) => {
            session = nextSession;
            if (nextSession) {
                // An identity-link callback may briefly expose the old guest
                // session. Keep waiting until the Google identity is applied.
                if (!authCallback || !nextSession.user.is_anonymous) {
                    resolveCallbackSession(nextSession);
                    updateAccountUi(nextSession.user, true);
                }
            } else if (!authCallback) {
                updateAccountUi(null, true);
            }
        });

        if (authCallback) {
            document.getElementById('account-status').textContent = 'Completing sign-in...';
            const oauthError = callbackError();
            if (oauthError) {
                clearAuthCallbackUrl();
                throw new Error(oauthError);
            }
            session = await withTimeout(callbackSession, 30000, 'Google sign-in completion');
            clearAuthCallbackUrl();
            updateAccountUi(session.user, true);
            if (authCallbackType === 'recovery' || authCallbackType === 'email_change' ||
                localStorage.getItem('soniscript-email-upgrade') === 'pending') {
                localStorage.removeItem('soniscript-email-upgrade');
                setAuthView('password');
                document.getElementById('account-modal').showModal();
            }
            return;
        }

        document.getElementById('account-status').textContent = 'Starting guest session...';
        const current = await withTimeout(client.auth.getSession(), 10000, 'Session check');
        if (current.error) throw current.error;
        session = current.data.session;
        if (!session) {
            const anonymous = await withTimeout(
                client.auth.signInAnonymously(), 15000, 'Guest sign-in'
            );
            if (anonymous.error) throw anonymous.error;
            session = anonymous.data.session;
        }
        updateAccountUi(session.user, true);
    })().catch(error => {
        // A created client can still perform Google/email login even when
        // automatic guest restoration failed. Only configuration/SDK failures
        // should disable every account action.
        initError = client ? null : error;
        console.error('Account initialization failed:', error);
        updateAccountUi(null, Boolean(client), error.message);
    });

    window.authReady = ready;
    window.fetch = async function (input, init = {}) {
        const url = typeof input === 'string' ? input : input.url;
        if (url === '/api/config') return nativeFetch(input, init);
        await ready;
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        if (session && session.access_token && url.startsWith('/')) {
            headers.set('Authorization', `Bearer ${session.access_token}`);
        }
        return nativeFetch(input, { ...init, headers });
    };

    function updateAccountUi(user, enabled, error) {
        const status = document.getElementById('account-status');
        const button = document.getElementById('account-button');
        const downloadButton = document.getElementById('download-btn');
        const deleteButton = document.getElementById('delete-btn');
        if (downloadButton) downloadButton.hidden = !enabled;
        if (deleteButton) deleteButton.hidden = !enabled;
        if (!status || !button) return;
        if (!enabled) {
            status.textContent = error ? 'Accounts unavailable' : 'Local mode';
            button.textContent = 'Account setup';
            return;
        }
        if (!user) {
            status.textContent = error ? 'Guest unavailable' : 'Starting guest session...';
            button.textContent = error ? 'Sign in' : 'Please wait';
            return;
        }
        const anonymous = Boolean(user && user.is_anonymous);
        status.textContent = anonymous ? 'Guest session' : (user.email || 'Signed in');
        button.textContent = anonymous ? 'Sign in' : 'Account';
        document.body.dataset.accountType = anonymous ? 'guest' : 'registered';
        const policy = document.getElementById('account-policy');
        if (policy && config) {
            const limits = anonymous ? config.limits.guest : config.limits.registered;
            policy.textContent = anonymous
                ? `${limits.daily} transcriptions/day · ${limits.max_minutes} min each · files expire after ${limits.retention_days} days`
                : `${limits.daily} transcriptions/day · ${limits.max_minutes} min each · private permanent library`;
        }
        window.dispatchEvent(new CustomEvent('soniscript-auth-change'));
    }

    const authCopy = {
        signin: ['Welcome back', 'Sign in to access your private LRC library.'],
        signup: ['Create your account', 'Keep your current guest files and access them on every device.'],
        forgot: ['Reset your password', 'We will send a secure password-reset link to your email.'],
        password: ['Choose a password', 'Finish securing your account with a password of at least 8 characters.'],
        account: ['Your account', 'Your LRC files are private and saved permanently.']
    };

    window.setAuthView = view => {
        document.querySelectorAll('[data-auth-panel]').forEach(panel => {
            panel.hidden = panel.dataset.authPanel !== view;
        });
        document.querySelectorAll('[data-auth-view]').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.authView === view);
        });
        const copy = authCopy[view] || authCopy.signin;
        document.getElementById('auth-title').textContent = copy[0];
        document.getElementById('auth-description').textContent = copy[1];
        document.getElementById('auth-tabs').hidden = !['signin', 'signup'].includes(view);
        showAuthMessage('');
    };
    window.openAccountModal = () => {
        const registered = session && !session.user.is_anonymous;
        if (registered) {
            document.getElementById('account-email').textContent = session.user.email || 'your account';
            setAuthView('account');
        } else {
            setAuthView('signin');
        }
        document.getElementById('account-modal').showModal();
    };
    window.closeAccountModal = () => document.getElementById('account-modal').close();
    window.signInGoogle = async () => {
        await ready;
        if (!client || initError) return showAuthMessage(initError?.message || 'Accounts are unavailable.', true);
        showAuthMessage('Opening Google...');
        try {
            const options = {
                redirectTo: window.location.origin,
                skipBrowserRedirect: true
            };
            const result = session && session.user.is_anonymous
                ? await withTimeout(client.auth.linkIdentity({ provider: 'google', options }), 30000, 'Google sign-in')
                : await withTimeout(client.auth.signInWithOAuth({ provider: 'google', options }), 30000, 'Google sign-in');
            if (result.error) return showAuthMessage(result.error.message, true);
            if (!result.data?.url) return showAuthMessage('Google did not return a sign-in URL. Please retry.', true);
            window.location.assign(result.data.url);
        } catch (error) { showAuthMessage(error.message, true); }
    };
    window.signInExistingGoogle = async () => {
        await ready;
        if (!client || initError) return showAuthMessage(initError?.message || 'Accounts are unavailable.', true);
        showAuthMessage('Opening Google...');
        try {
            const result = await withTimeout(client.auth.signInWithOAuth({
                provider: 'google', options: {
                    redirectTo: window.location.origin,
                    skipBrowserRedirect: true
                }
            }), 30000, 'Google sign-in');
            if (result.error) return showAuthMessage(result.error.message, true);
            if (!result.data?.url) return showAuthMessage('Google did not return a sign-in URL. Please retry.', true);
            window.location.assign(result.data.url);
        } catch (error) { showAuthMessage(error.message, true); }
    };
    window.signInEmailPassword = async () => {
        await ready;
        if (!client || initError) return showAuthMessage(initError?.message || 'Accounts are unavailable.', true);
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;
        if (!email) return showAuthMessage('Enter your email address.', true);
        if (!password) return showAuthMessage('Enter your password.', true);
        showAuthMessage('Signing in...');
        try {
            const result = await withTimeout(
                client.auth.signInWithPassword({ email, password }), 30000, 'Email sign-in'
            );
            if (result.error) throw result.error;
            session = result.data.session;
            updateAccountUi(session.user, true);
            closeAccountModal();
        } catch (error) { return showAuthMessage(error.message, true); }
    };

    window.startEmailAccount = async () => {
        await ready;
        if (!client || initError) return showAuthMessage(initError?.message || 'Accounts are unavailable.', true);
        const email = document.getElementById('signup-email').value.trim();
        if (!email) return showAuthMessage('Enter your email address.', true);
        if (!session?.user?.is_anonymous) return showAuthMessage('This browser is already signed in.', true);
        showAuthMessage('Sending confirmation email...');
        try {
            const result = await withTimeout(
                client.auth.updateUser({ email }, { emailRedirectTo: window.location.origin }),
                30000, 'Email confirmation'
            );
            if (result.error) throw result.error;
            localStorage.setItem('soniscript-email-upgrade', 'pending');
            showAuthMessage('Email sent. Open the confirmation link to verify your address and choose a password.');
        } catch (error) { showAuthMessage(error.message, true); }
    };

    window.requestPasswordReset = async () => {
        await ready;
        const email = document.getElementById('reset-email').value.trim();
        if (!email) return showAuthMessage('Enter your email address.', true);
        showAuthMessage('Sending password reset email...');
        try {
            const result = await withTimeout(client.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin
            }), 30000, 'Password reset');
            if (result.error) throw result.error;
            showAuthMessage('Reset email sent. Open its link to choose a new password.');
        } catch (error) { showAuthMessage(error.message, true); }
    };

    window.saveAccountPassword = async () => {
        await ready;
        const password = document.getElementById('new-password').value;
        if (password.length < 8) return showAuthMessage('Use at least 8 characters.', true);
        showAuthMessage('Saving password...');
        try {
            const result = await withTimeout(client.auth.updateUser({ password }), 30000, 'Password update');
            if (result.error) throw result.error;
            session = (await client.auth.getSession()).data.session;
            updateAccountUi(session.user, true);
            showAuthMessage('Password saved. Your account is ready.');
            setTimeout(closeAccountModal, 700);
        } catch (error) { showAuthMessage(error.message, true); }
    };
    window.signOutAccount = async () => {
        await ready;
        showAuthMessage('Signing out...');
        const button = document.getElementById('account-signout');
        if (button) button.disabled = true;
        try {
            if (client) await withTimeout(client.auth.signOut({ scope: 'local' }), 8000, 'Sign out');
        } catch (error) {
            console.warn('Remote sign-out was slow; clearing the local session.', error);
        } finally {
            session = null;
            try { localStorage.removeItem('soniscript-auth-v2'); } catch (_) {}
        }

        // Move directly into a new guest session. This avoids a full reload,
        // removes the "starting guest" flicker, and keeps Google available if
        // guest creation itself is temporarily unavailable.
        updateAccountUi(null, true);
        try {
            const anonymous = await withTimeout(
                client.auth.signInAnonymously(), 30000, 'Guest sign-in'
            );
            if (anonymous.error) throw anonymous.error;
            session = anonymous.data.session;
            updateAccountUi(session.user, true);
            showAuthMessage('Signed out. You are now using guest mode.');
            setTimeout(closeAccountModal, 500);
        } catch (error) {
            updateAccountUi(null, true, error.message);
            showAuthMessage(`Signed out, but guest mode could not start: ${error.message}`, true);
        }
    };
    function showAuthMessage(text, error = false) {
        const element = document.getElementById('auth-message');
        element.textContent = text;
        element.className = error ? 'auth-message error' : 'auth-message';
    }
})();
