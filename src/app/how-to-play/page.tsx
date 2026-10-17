import Link from "next/link";

export const metadata = { title: "Så spelar du – OUTBREAK" };

export default function HowToPlay() {
  return (
    <main className="page">
      <div className="topbar"><Link className="back" href="/" aria-label="Tillbaka">←</Link><h1>HOW TO PLAY</h1></div>

      <div className="card warn">
        <b>Säkerhet först.</b> Spelet är bara en vägledning. Du bestämmer alltid hur du rör dig. Följ trafikregler, korsa inte väg eller järnväg bara för att spelet föreslår det, och gå eller cykla inte in på privat mark, i farlig terräng eller över vatten. Titta aldrig på skärmen när du cyklar – använd ljud och vibration, eller stanna. Du kan avsluta när som helst, och det kostar ingenting att stanna av säkerhetsskäl.
      </div>

      <h2>Idén</h2>
      <p>Zombier rör sig bara längs verkliga stigar och vägar. Du rör dig i verkligheten med telefonen i fickan eller på styret. Spelet följer din GPS-position.</p>

      <h2>Spellägen</h2>
      <ul>
        <li><b>MISSION</b> – en slinga från start. Nå 1–3 checkpoints i ordning och gå sedan tillbaka till start.</li>
        <li><b>ESCAPE</b> – ta dig från start till en målpunkt (A→B).</li>
        <li><b>SURVIVAL</b> – ingen rutt. Överlev tills extraction öppnar (efter 80 % av matchtiden) och nå den.</li>
      </ul>
      <p>Rutten som visas är ett förslag. Du får gå var du vill – men zombierna följer bara stigarna, och mål räknas först när du står inom 30 m i 5 sekunder.</p>

      <h2>Aktivitet och svårighet</h2>
      <p>Promenad, löpning och MTB använder olika stignät, fart och tidsgränser. Svårighet påverkar antal och fart på zombier samt marginalen i tidsgränsen. Det finns ingen bonus för att vara snabbare.</p>

      <h2>Smitta</h2>
      <p>Är en zombie inom 20 m under ett par sekunder blir du smittad och matchen är över. Vid osäker GPS (stor noggrannhet) räknas smitta långsammare eller pausas. Spelet registrerar aldrig smitta från en gammal eller gissad position.</p>

      <h2>GPS och skärm</h2>
      <ul>
        <li>Appen måste vara öppen och i förgrunden. Webbläsare kan inte garantera GPS i bakgrunden – låser du skärmen eller byter app pausas spelet och du fortsätter manuellt.</li>
        <li>Tappar GPS-signalen står spelklockan och zombierna stilla tills signalen är tillbaka.</li>
        <li>Spelet försöker hålla skärmen tänd. Det drar mer batteri; ta med en powerbank på längre pass.</li>
        <li>Bäst noggrannhet får du under bar himmel. Under täta granar och nära branter kan positionen vara osäker.</li>
      </ul>

      <h2>Kartdata</h2>
      <p>Stigar och vägar kommer från OpenStreetMap (© OpenStreetMap-bidragsgivare, ODbL). Kartdata kan vara ofullständig eller felaktig. Spelet utesluter stigar som är markerade som privata eller förbjudna och försöker undvika vägar, järnvägar och vatten – men att en sträcka syns i spelet betyder inte att den är säker eller tillåten.</p>

      <h2>Din data</h2>
      <p>Matcher, GPS-uppgifter och testloggar sparas bara lokalt på din enhet. Ingen inloggning, ingen uppladdning. Du kan radera matcher under PREVIOUS GAMES.</p>
      <p>Bakgrundskartan (skog, vatten, vägar) hämtas som kartrutor från OpenFreeMap (data © OpenStreetMap-bidragsgivare, © OpenMapTiles). Då ser kartleverantören din IP-adress och vilket kartområde som visas, men inte dina GPS-positioner som sådana eller dina matcher. Utan nät fungerar spelet med bara stignätet.</p>
    </main>
  );
}
