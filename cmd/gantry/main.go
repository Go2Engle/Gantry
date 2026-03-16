// Package main is the entry point for the Gantry CLI.
// It assembles all subcommands and executes the root cobra command.
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "gantry",
		Short: "Gantry - The Developer Platform That Just Works",
		Long: `Gantry is an internal developer platform that provides a unified catalog
of services, APIs, infrastructure, teams, and documentation. It helps
engineering organizations understand and manage their software ecosystem.`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	rootCmd.AddCommand(
		serveCmd(),
		applyCmd(),
		getCmd(),
		describeCmd(),
		exportCmd(),
		runCmd(),
		versionCmd(),
		installCmd(),
		upgradeCmd(),
		uninstallCmd(),
	)

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
