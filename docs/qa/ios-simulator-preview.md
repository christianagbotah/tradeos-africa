# iOS preview and distribution

The manual iOS simulator workflow builds the existing native Expo application on a GitHub-hosted macOS runner, typechecks and tests the source, generates the native iOS project and validates the resulting simulator bundle. Its archive is for the matching simulator architecture only; it is not an IPA, a physical-device installer or an App Store build. No Apple signing credentials are required for the simulator build.

Physical iPhone/iPad testing and TestFlight distribution require an authorized Apple Developer team, registered app identifier, distribution signing and provisioning, App Store Connect configuration, and a separate reviewed release workflow. Keep signing material out of Git and do not reuse the simulator identifier for production without an explicit distribution decision. Preview users should use test businesses until the server upgrade and real-device acceptance tests are complete.
