// The donate button stays hidden until this holds the PayPal link.
export const DONATE_URL = '';

export const DONATE_MESSAGES = [
    'Well, well, well... how the turntables. You just willingly paid for free software. Thank you!',
    "Sometimes I'll start writing a line of code, and I don't even know where it's going. I just hope I find it along the way. Your donation helps me find it.",
    'You just did the exact equivalent of buying a WinRAR license. You are an absolute legend. Thank you!',
    "I haven't been this shocked since someone told me they actually paid for WinRAR after the 40-day trial. Your support means the world!",
    "Unlike a certain file-unzipping program, I won't nag you every time you open this for the next 15 years. Thanks for the donation!",
];

export function pickDonateMessage(random: () => number = Math.random): string {
    return DONATE_MESSAGES[Math.floor(random() * DONATE_MESSAGES.length)];
}

export function setupDonate(url: string = DONATE_URL) {
    const button = document.getElementById('donate-button')!;
    const pane = document.getElementById('donate-pane')!;
    const message = document.getElementById('donate-message')!;
    const link = document.getElementById('donate-link') as HTMLAnchorElement;

    button.hidden = !url;
    link.href = url;

    button.addEventListener('click', () => {
        // Every opening picks again, so the joke can change.
        message.textContent = pickDonateMessage();
        pane.hidden = !pane.hidden;
    });
    document.getElementById('donate-close')!.addEventListener('click', () => { pane.hidden = true; });
}
