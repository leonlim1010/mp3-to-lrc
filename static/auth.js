(function () {
    const nativeFetch = window.fetch.bind(window);
    let client = null;
    let session = null;
    let config = null;
    let initError = null;

    function withTimeout(promise, milliseconds, label) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out. Please retry.`)), milliseconds);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    // Serialize auth work inside this page without relying on navigator.locks,
    // which can remain stuck in some browsers after an interrupted refresh.
    let authQueue = Promise.resolve();
    function browserSafeLock(_name, _acquireTimeout, operation) {
        const result = authQueue.then(operation, operation);
        authQueue = result.catch(() => undefined);
        return result;
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
                storageKey: 'soniscript-auth-v2',
                lock: browserSafeLock
            }
        });
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
        client.auth.onAuthStateChange((_event, nextSession) => {
            session = nextSession;
            updateAccountUi(session && session.user, true);
        });
    })().catch(error => {
        initError = error;
        console.error('Account initialization failed:', error);
        updateAccountUi(null, false, error.message);
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
    }

    window.openAccountModal = () => document.getElementById('account-modal').showModal();
    window.closeAccountModal = () => document.getElementById('account-modal').close();
    window.signInGoogle = async () => {
        await ready;
        if (!client || initError) return showAuthMessage(initError?.message || 'Accounts are unavailable.', true);
        showAuthMessage('Opening Google...');
        try {
            const result = session && session.user.is_anonymous
                ? await withTimeout(client.auth.linkIdentity({ provider: 'google', options: { redirectTo: window.location.origin } }), 15000, 'Google sign-in')
                : await withTimeout(client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }), 15000, 'Google sign-in');
            if (result.error) showAuthMessage(result.error.message, true);
        } catch (error) { showAuthMessage(error.message, true); }
    };
    window.signInExistingGoogle = async () => {
        await ready;
        await client.auth.signOut({ scope: 'local' });
        const result = await client.auth.signInWithOAuth({
            provider: 'google', options: { redirectTo: window.location.origin }
        });
        if (result.error) showAuthMessage(result.error.message, true);
    };
    window.sendEmailOtp = async () => {
        await ready;
        if (!client || initError) return showAuthMessage(initError?.message || 'Accounts are unavailable.', true);
        const email = document.getElementById('auth-email').value.trim();
        if (!email) return showAuthMessage('Enter your email address.', true);
        showAuthMessage('Sending verification code...');
        let result;
        try {
            result = session && session.user.is_anonymous
                ? await withTimeout(client.auth.updateUser({ email }), 15000, 'Email verification')
                : await withTimeout(client.auth.signInWithOtp({ email }), 15000, 'Email verification');
        } catch (error) { return showAuthMessage(error.message, true); }
        if (result.error) return showAuthMessage(result.error.message, true);
        document.getElementById('otp-row').hidden = false;
        showAuthMessage('Check your email for the verification code.');
    };
    window.verifyEmailOtp = async () => {
        const email = document.getElementById('auth-email').value.trim();
        const token = document.getElementById('auth-otp').value.trim();
        const type = session && session.user.is_anonymous ? 'email_change' : 'email';
        const result = await client.auth.verifyOtp({ email, token, type });
        if (result.error) return showAuthMessage(result.error.message, true);
        closeAccountModal();
        location.reload();
    };
    window.sendExistingEmailOtp = async () => {
        await ready;
        const email = document.getElementById('auth-email').value.trim();
        if (!email) return showAuthMessage('Enter your email address.', true);
        await client.auth.signOut({ scope: 'local' });
        const result = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (result.error) return showAuthMessage(result.error.message, true);
        document.getElementById('otp-row').hidden = false;
        showAuthMessage('Check your email for the sign-in code.');
    };
    window.signOutAccount = async () => {
        await ready;
        await client.auth.signOut();
        location.reload();
    };
    function showAuthMessage(text, error = false) {
        const element = document.getElementById('auth-message');
        element.textContent = text;
        element.className = error ? 'auth-message error' : 'auth-message';
    }
})();
