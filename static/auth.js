(function () {
    const nativeFetch = window.fetch.bind(window);
    let client = null;
    let session = null;
    let config = null;

    const ready = (async () => {
        config = await nativeFetch('/api/config').then(response => response.json());
        window.appConfig = config;
        if (!config.accounts_enabled) {
            updateAccountUi(null, false);
            return;
        }
        client = window.supabase.createClient(config.supabase_url, config.supabase_key, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        const current = await client.auth.getSession();
        session = current.data.session;
        if (!session) {
            const anonymous = await client.auth.signInAnonymously();
            if (anonymous.error) throw anonymous.error;
            session = anonymous.data.session;
        }
        updateAccountUi(session.user, true);
        client.auth.onAuthStateChange((_event, nextSession) => {
            session = nextSession;
            updateAccountUi(session && session.user, true);
        });
    })().catch(error => {
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
        const result = session && session.user.is_anonymous
            ? await client.auth.linkIdentity({ provider: 'google', options: { redirectTo: window.location.origin } })
            : await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
        if (result.error) showAuthMessage(result.error.message, true);
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
        const email = document.getElementById('auth-email').value.trim();
        if (!email) return showAuthMessage('Enter your email address.', true);
        const result = session && session.user.is_anonymous
            ? await client.auth.updateUser({ email })
            : await client.auth.signInWithOtp({ email });
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
