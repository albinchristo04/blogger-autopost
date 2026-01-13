import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const SCOPES = 'https://www.googleapis.com/auth/blogger';
const REDIRECT_URI = 'https://oauth2.googleapis.com/token'; // For manual copy-paste flow usually 'urn:ietf:wg:oauth:2.0:oob' or localhost, but let's try the standard manual flow

console.log('--- Google OAuth 2.0 Refresh Token Generator ---');
console.log('You need your Client ID and Client Secret from Google Cloud Console.');

rl.question('Enter Client ID: ', (clientId) => {
    rl.question('Enter Client Secret: ', (clientSecret) => {

        // 1. Generate Auth URL
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId.trim());
        authUrl.searchParams.set('redirect_uri', 'http://localhost:8080/oauth2callback'); // Must match Console exactly
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        console.log('\n1. Visit this URL in your browser:');
        console.log(authUrl.toString());
        console.log('\n2. Authorize the app.');
        console.log('3. You will be redirected to a localhost URL (it might fail to load, that is fine).');
        console.log('4. Copy the "code" parameter from the address bar (everything after code= and before &).');

        rl.question('\nEnter the code here: ', async (code) => {
            // 2. Exchange code for token
            try {
                const tokenUrl = 'https://oauth2.googleapis.com/token';
                const params = new URLSearchParams();
                params.set('client_id', clientId.trim());
                params.set('client_secret', clientSecret.trim());
                params.set('code', decodeURIComponent(code.trim()));
                params.set('grant_type', 'authorization_code');
                params.set('redirect_uri', 'http://localhost:8080/oauth2callback');

                const res = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params
                });

                const data = await res.json();

                if (data.error) {
                    console.error('\n[ERROR] Failed to get token:', data);
                } else {
                    console.log('\n[SUCCESS] Here are your tokens:');
                    console.log('---------------------------------------------------');
                    console.log('REFRESH_TOKEN:', data.refresh_token);
                    console.log('ACCESS_TOKEN:', data.access_token);
                    console.log('---------------------------------------------------');
                    console.log('Save the REFRESH_TOKEN in your .env file or GitHub Secrets.');
                }
            } catch (err) {
                console.error('\n[ERROR] Exception:', err.message);
            }
            rl.close();
        });
    });
});
