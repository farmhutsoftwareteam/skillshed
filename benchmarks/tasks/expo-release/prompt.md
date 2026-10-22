We're shipping Tidy 1.0 to the App Store and Google Play next week, using EAS Build and EAS Submit. Get the project's config ready for store releases, so that `eas build --profile production --auto-submit` works for both platforms and we never have to bump build numbers by hand.

We don't have the App Store Connect app ID or the Play service account key in this repo yet; leave clearly marked placeholders where they go. You can't run eas or reach Expo's servers from here, so just edit the config files.
