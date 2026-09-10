# Plain installable source — version from package.json (must match JoeVersion.APP_VERSION).
{ pkgs ? import <nixpkgs> {} }:

let
  version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
in
pkgs.stdenv.mkDerivation {
  pname = "joedesk";
  inherit version;

  src = ./.;

  nativeBuildInputs = [ pkgs.nodejs_22 ];

  dontBuild = true;

  installPhase = ''
    mkdir -p $out/share/joedesk/public
    cp -r $src/public/. $out/share/joedesk/public/

    mkdir -p $out/bin
    cat > $out/bin/joedesk-server <<EOF
#!/bin/sh
exec ${pkgs.nodejs_22}/bin/node $out/share/joedesk/server.mjs
EOF
    chmod +x $out/bin/joedesk-server

    install -m 644 $src/server.mjs $src/validate.mjs $out/share/joedesk/
  '';

  meta = {
    description = "Joe household paper-trading desk dashboard";
    mainProgram = "joedesk-server";
  };
}
