package fr.echimine.live.ui

/**
 * Textes de permission recommandés pour lancer un Live ou monter à l'écran.
 * Affichés par l'écran de lancement avant la demande système ; à reprendre dans la fiche
 * Play Store de l'App membre (section « Sécurité des données »).
 */
public object LivePermissionTexts {
    public const val CAMERA: String =
        "La caméra sert à vous filmer pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré."

    public const val MICROPHONE: String =
        "Le micro sert à vous faire entendre pendant votre Live ou quand vous montez à l'écran. Rien n'est enregistré."
}
