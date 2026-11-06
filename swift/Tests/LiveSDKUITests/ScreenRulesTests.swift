import Testing
import LiveSDK
import LiveSDKUI

@Suite("Écrans : lien direct, titre et initiale")
struct ScreenRulesTests {
    @Test(arguments: [
        ("lv_8f3k2m", "lv_8f3k2m"),
        ("  lv_8f3k2m \n", "lv_8f3k2m"),
        ("https://live.echimine.fr/v1/lives/lv_8f3k2m", "lv_8f3k2m"),
        ("https://twitch-clone.example/lives/lv_8f3k2m/?ref=story#top", "lv_8f3k2m"),
        ("crosslive://lives/lv-2b9q7x", "lv-2b9q7x"),
    ])
    func unLienOuUnIdentifiantColleDonneLeLive(input: String, expected: String) {
        #expect(LiveLink.liveId(from: input) == expected)
    }

    @Test(arguments: [
        "", "   ", "https://live.echimine.fr/", "lv 8f3k2m", "lv_8f3k2m!",
        "https://localhost/", "https://live.echimine.fr/v1/lives", "crosslive://lives/", "crosslive://lives",
    ])
    func unTexteInexploitableNeDonneRien(input: String) {
        #expect(LiveLink.liveId(from: input) == nil)
    }

    @Test func leTitreEstCoupeA80CaracteresVisiblesSansCasserUnEmoji() {
        let title = String(repeating: "a", count: 79) + "👩‍👩‍👧‍👦" + "zzz"

        let limited = LiveTitle.limited(title)

        #expect(limited == String(repeating: "a", count: 79) + "👩‍👩‍👧‍👦")
        #expect(LiveTitle.visibleLength(limited) == 80)
    }

    @Test func unTitreCourtResteIntact() {
        #expect(LiveTitle.limited("Unboxing") == "Unboxing")
    }

    @Test(arguments: [("léa", "L"), ("  Noa", "N"), ("👩‍👩‍👧 Fam", "👩‍👩‍👧"), ("", "?")])
    func lInitialeDuPseudoRemplaceLAvatar(name: String, expected: String) {
        #expect(Participant(id: "a:1", app: "a", name: name).initial == expected)
    }
}
